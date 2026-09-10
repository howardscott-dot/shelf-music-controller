import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, opendir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';
import type { AlbumDetail, AlbumSummary, Track } from './types.js';
import { z } from 'zod';

const audioExtensions = new Set(['.aac', '.aif', '.aiff', '.alac', '.ape', '.dff', '.dsf', '.flac', '.m4a', '.mp3', '.mpc', '.oga', '.ogg', '.opus', '.wav', '.wma']);
const imageNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.jpeg', 'folder.png', 'front.jpg', 'front.jpeg', 'front.png'];
const scanFreshnessMs = 60 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

interface LocalTrack extends Track { file: string }
interface LocalAlbum extends AlbumDetail { localTracks: LocalTrack[]; folder: string }
interface LibrarySnapshot { version: 1; root: string; scannedAt: number; albums: LocalAlbum[] }

async function walk(directory: string, output: string[]) {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, output);
    else if (entry.isFile() && audioExtensions.has(extname(entry.name).toLowerCase())) output.push(path);
    if (output.length > 100_000) throw new Error('The music folder contains more than 100,000 audio files. Narrow the mounted folder.');
  }
}

export class FileLibrary {
  private albumsById = new Map<string, LocalAlbum>();
  private tracksById = new Map<string, LocalTrack>();
  private scannedAt = 0;
  private scanning?: Promise<void>;
  private cacheLoaded = false;
  private artworkPreviews = new Map<string, Promise<{ data: Buffer; type: string } | undefined>>();
  constructor(private readonly root?: string, private readonly publicUrl?: string, private readonly cacheFile?: string) {}
  get configured() { return Boolean(this.root && this.publicUrl); }
  async status() {
    if (!this.configured) return { configured: false };
    try { const info = await stat(resolve(this.root!)); if (!info.isDirectory()) throw new Error('The configured music path is not a folder.'); await this.loadCache(); return { configured: true, connected: true, path: basename(this.root!), albums: this.scannedAt ? this.albumsById.size : undefined }; }
    catch (error) { return { configured: true, connected: false, error: error instanceof Error ? error.message : 'Music folder unavailable' }; }
  }
  private requireConfig() {
    if (!this.root || !this.publicUrl) throw new Error('A mounted music folder is not configured on this SHELF server.');
  }
  private async ensure(force = false) {
    this.requireConfig();
    await this.loadCache();
    if (!force && this.scannedAt) {
      if (Date.now() - this.scannedAt >= scanFreshnessMs && !this.scanning) void this.beginScan().catch(() => undefined);
      return;
    }
    return this.beginScan();
  }
  private beginScan() {
    if (this.scanning) return this.scanning;
    this.scanning = this.scan().finally(() => { this.scanning = undefined; });
    return this.scanning;
  }
  private async loadCache() {
    if (this.cacheLoaded || !this.cacheFile || !this.root) return;
    this.cacheLoaded = true;
    try {
      const snapshot = JSON.parse(await readFile(this.cacheFile, 'utf8')) as LibrarySnapshot;
      const root = resolve(this.root);
      if (snapshot.version !== 1 || resolve(snapshot.root) !== root || !Array.isArray(snapshot.albums) || !Number.isFinite(snapshot.scannedAt)) return;
      const albums = new Map<string, LocalAlbum>();
      const tracks = new Map<string, LocalTrack>();
      for (const album of snapshot.albums) {
        if (!album?.id || !Array.isArray(album.localTracks) || album.localTracks.some((track) => !track?.id || !resolve(track.file).startsWith(`${root}${sep}`))) return;
        albums.set(album.id, album);
        for (const track of album.localTracks) tracks.set(track.id, track);
      }
      this.albumsById = albums; this.tracksById = tracks; this.scannedAt = snapshot.scannedAt;
    } catch { /* No usable cache yet; the first request will build one. */ }
  }
  private async saveCache() {
    if (!this.cacheFile || !this.root) return;
    await mkdir(dirname(this.cacheFile), { recursive: true });
    const temporary = `${this.cacheFile}.${process.pid}.tmp`;
    const snapshot: LibrarySnapshot = { version: 1, root: resolve(this.root), scannedAt: this.scannedAt, albums: [...this.albumsById.values()] };
    await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.cacheFile);
  }
  private async scan() {
    const files: string[] = [];
    await walk(resolve(this.root!), files);
    const albums = new Map<string, LocalAlbum>();
    const tracks = new Map<string, LocalTrack>();
    for (let offset = 0; offset < files.length; offset += 8) {
      const batch = files.slice(offset, offset + 8);
      const parsed = await Promise.all(batch.map(async (file) => {
        // Reading tags is enough to build the shelf. Asking music-metadata to
        // calculate exact durations can force a full read of thousands of files
        // on a NAS and makes the first opening feel stalled.
        try { return { file, metadata: await parseFile(file, { duration: false, skipCovers: true }) }; }
        catch { return undefined; }
      }));
      for (const item of parsed) {
        if (!item) continue;
        const { file, metadata } = item;
        const parts = relative(resolve(this.root!), file).split(sep);
        const fallbackAlbum = parts.at(-2) || 'Loose tracks';
        const fallbackArtist = parts.at(-3) || 'Unknown artist';
        const title = metadata.common.title || basename(file, extname(file));
        const albumTitle = metadata.common.album || fallbackAlbum;
        const artist = metadata.common.albumartist || metadata.common.artist || fallbackArtist;
        const trackArtist = metadata.common.artist || artist;
        const albumId = hash(`${artist}\0${albumTitle}`.toLocaleLowerCase());
        const trackId = hash(relative(resolve(this.root!), file));
        const track: LocalTrack = { id: trackId, title, artist: trackArtist, album: albumTitle, index: metadata.common.track.no ?? 0, disc: metadata.common.disk.no ?? 1, durationSeconds: Math.round(metadata.format.duration ?? 0), file };
        tracks.set(trackId, track);
        let album = albums.get(albumId);
        if (!album) {
          album = { source: 'files', id: albumId, title: albumTitle, artist, year: metadata.common.year, genres: metadata.common.genre ?? [], artworkUrl: `/api/files/artwork/${albumId}`, backArtworkUrl: '', spineUrl: `/api/files/artwork/${albumId}`, tracks: [], localTracks: [], durationSeconds: 0, folder: dirname(file) };
          albums.set(albumId, album);
        }
        album.localTracks.push(track);
      }
    }
    for (const album of albums.values()) {
      album.localTracks.sort((a, b) => a.disc - b.disc || (a.index || 9999) - (b.index || 9999) || a.title.localeCompare(b.title));
      album.tracks = album.localTracks.map(({ file: _file, ...track }) => track);
      album.durationSeconds = album.tracks.reduce((total, track) => total + track.durationSeconds, 0);
    }
    this.albumsById = albums; this.tracksById = tracks; this.scannedAt = Date.now();
    await this.saveCache();
  }
  private public(path: string) { return new URL(path, this.publicUrl).toString(); }
  async albums(start = 0, limit = 100) {
    await this.ensure();
    const all = [...this.albumsById.values()].sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    return { items: all.slice(start, start + limit).map((album) => this.summary(album)), total: all.length };
  }
  private thumbnailUrl(id: string) { return `/api/files/artwork/${encodeURIComponent(id)}?width=360`; }
  private summary(album: LocalAlbum): AlbumSummary { const { tracks: _tracks, localTracks: _local, durationSeconds: _duration, folder: _folder, ...summary } = album; return { ...summary, thumbnailUrl: this.thumbnailUrl(album.id) }; }
  async album(id: string) { await this.ensure(); const album = this.albumsById.get(id); if (!album) throw new Error('Album not found in the mounted music folder.'); const { localTracks: _local, folder: _folder, ...view } = album; return { ...view, thumbnailUrl: this.thumbnailUrl(album.id) }; }
  streamUrl(trackId: string) { if (!this.tracksById.has(trackId)) throw new Error('Track not found in the mounted music folder.'); return this.public(`/api/files/audio/${encodeURIComponent(trackId)}`); }
  playerArtworkUrl(albumId: string) { return this.public(`/api/files/artwork/${encodeURIComponent(albumId)}`); }
  async trackFile(id: string) { await this.ensure(); const track = this.tracksById.get(id); if (!track) throw new Error('Track not found.'); return track.file; }
  private async originalArtwork(id: string): Promise<{ data: Buffer; type: string } | undefined> {
    const album = this.albumsById.get(id); if (!album) return undefined;
    try {
      const names = await readdir(album.folder); const preferred = imageNames.find((candidate) => names.some((name) => name.toLocaleLowerCase() === candidate));
      const actual = preferred && names.find((name) => name.toLocaleLowerCase() === preferred);
      if (actual) return { data: await readFile(resolve(album.folder, actual)), type: actual.toLocaleLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' };
    } catch { /* try embedded artwork */ }
    try {
      const metadata = await parseFile(album.localTracks[0]!.file, { duration: false });
      const picture = metadata.common.picture?.[0];
      if (picture) return { data: Buffer.from(picture.data), type: picture.format || 'image/jpeg' };
    } catch { /* no artwork */ }
    return undefined;
  }
  async artwork(id: string, width?: number): Promise<{ data: Buffer; type: string } | undefined> {
    await this.ensure();
    if (!width) return this.originalArtwork(id);
    const safeWidth = Math.max(64, Math.min(640, Math.round(width)));
    const key = `${id}:${safeWidth}`;
    const cached = this.artworkPreviews.get(key);
    if (cached) return cached;
    const preview = (async () => {
      const original = await this.originalArtwork(id);
      if (!original) return undefined;
      try {
        return { data: await sharp(original.data, { limitInputPixels: 40_000_000 }).autoOrient().resize({ width: safeWidth, height: safeWidth, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer(), type: 'image/jpeg' };
      } catch { return undefined; }
    })();
    if (this.artworkPreviews.size >= 80) this.artworkPreviews.delete(this.artworkPreviews.keys().next().value!);
    this.artworkPreviews.set(key, preview);
    const result = await preview;
    if (!result) this.artworkPreviews.delete(key);
    return result;
  }
  async refresh() { await this.ensure(true); this.artworkPreviews.clear(); return { ok: true, albums: this.albumsById.size }; }
}

const mime = (file: string) => ({ '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.wma': 'audio/x-ms-wma', '.alac': 'audio/mp4', '.ape': 'audio/ape', '.mpc': 'audio/musepack', '.dsf': 'audio/dsd', '.dff': 'audio/dsd' }[extname(file).toLowerCase()] ?? 'application/octet-stream');

export async function fileLibraryRoutes(app: FastifyInstance, { library, playback }: { library: FileLibrary; playback: { state: () => Promise<unknown>; start: (albumId: string, trackId: string, library: FileLibrary, artwork: string) => Promise<unknown>; control: (action: string, body?: { positionSeconds?: number; volume?: number; muted?: boolean }) => Promise<unknown> } }) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') return;
    let other = false; try { other = !!request.headers.origin && new URL(request.headers.origin).host !== request.headers.host; } catch { other = true; }
    if (request.headers['sec-fetch-site'] === 'cross-site' || other) return reply.code(403).send({ error: 'Playback controls must be used from SHELF on this server.' });
  });
  app.get('/status', async () => library.status());
  app.post('/refresh', async () => library.refresh());
  app.get('/albums', async (request) => { const query = request.query as { start?: string; limit?: string }; return library.albums(Number(query.start ?? 0), Math.min(200, Number(query.limit ?? 100))); });
  app.get('/albums/:id', async (request) => library.album((request.params as { id: string }).id));
  app.get('/artwork/:id', async (request, reply) => { const requested = Number((request.query as { width?: string }).width); const width = Number.isFinite(requested) && requested > 0 ? requested : undefined; const art = await library.artwork((request.params as { id: string }).id, width); if (!art) return reply.code(404).send({ error: 'Artwork unavailable' }); reply.header('Content-Type', art.type); reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800'); return reply.send(art.data); });
  app.get('/audio/:id', async (request, reply) => {
    const file = await library.trackFile((request.params as { id: string }).id);
    const info = await stat(file); const range = request.headers.range;
    reply.header('Accept-Ranges', 'bytes'); reply.header('Content-Type', mime(file));
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) return reply.code(416).send();
      const start = match[1] ? Number(match[1]) : 0; const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`).header('Content-Length', end - start + 1);
      return reply.send(createReadStream(file, { start, end }));
    }
    reply.header('Content-Length', info.size); return reply.send(createReadStream(file));
  });
  app.get('/playback', async () => playback.state());
  app.post('/playback/track/:id', async (request) => { const trackId = z.string().regex(/^[a-f\d]{32}$/).parse((request.params as { id: string }).id); const albumId = z.object({ albumId: z.string().regex(/^[a-f\d]{32}$/) }).parse(request.body).albumId; await playback.start(albumId, trackId, library, library.playerArtworkUrl(albumId)); return { ok: true }; });
  app.post('/playback/:action', async (request) => { const action = z.enum(['play', 'pause', 'stop', 'seek', 'volume', 'mute', 'next', 'previous']).parse((request.params as { action: string }).action); const body = z.object({ positionSeconds: z.number().finite().min(0).max(86400).optional(), volume: z.number().finite().min(0).max(100).optional(), muted: z.boolean().optional() }).parse(request.body ?? {}); if (action === 'seek') z.number().parse(body.positionSeconds); if (action === 'volume') z.number().parse(body.volume); if (action === 'mute') z.boolean().parse(body.muted); await playback.control(action, body); return { ok: true }; });
}
