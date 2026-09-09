import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { JellyfinPlayback } from './jellyfin-playback.js';
import type { JellyfinClient } from './jellyfin.js';
import type { SpotifyClient } from './spotify.js';
import type { PlexClient } from './plex.js';
import type { FileLibrary } from './file-library.js';
import type { AlbumDetail, AlbumSummary } from './types.js';

type Source = 'jellyfin' | 'spotify' | 'plex' | 'files';
type Library = Pick<JellyfinClient, 'albums' | 'album'> | Pick<SpotifyClient, 'albums' | 'album'> | Pick<PlexClient, 'albums' | 'album'> | Pick<FileLibrary, 'albums' | 'album'>;
interface AlbumRef { source: Source; albumId: string; title: string; artist: string; artworkUrl?: string; addedAt: string }
interface Crate { id: string; name: string; createdAt: string; albums: AlbumRef[] }
interface HistoryEntry { source: Source; albumId: string; title: string; artist: string; playedAt: string }
interface FeatureData { crates: Crate[]; history: HistoryEntry[] }

const sourceSchema = z.enum(['jellyfin', 'spotify', 'plex', 'files']);
const albumRefSchema = z.object({ source: sourceSchema, albumId: z.string().min(1).max(256), title: z.string().trim().min(1).max(300), artist: z.string().trim().min(1).max(300), artworkUrl: z.string().max(2048).optional() });

class FeatureStore {
  private data: FeatureData = { crates: [], history: [] };
  private readonly file: string;
  private ready: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  constructor(directory: string) { this.file = join(directory, 'features.json'); this.ready = this.restore(); }
  private async restore() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<FeatureData>;
      this.data = { crates: Array.isArray(parsed.crates) ? parsed.crates : [], history: Array.isArray(parsed.history) ? parsed.history : [] };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    return this.writing;
  }
  async crates() { await this.ready; return structuredClone(this.data.crates); }
  async createCrate(name: string) { await this.ready; const crate = { id: randomUUID(), name, createdAt: new Date().toISOString(), albums: [] }; this.data.crates.push(crate); await this.save(); return crate; }
  async deleteCrate(id: string) { await this.ready; const before = this.data.crates.length; this.data.crates = this.data.crates.filter((crate) => crate.id !== id); if (before === this.data.crates.length) return false; await this.save(); return true; }
  async addToCrate(id: string, value: z.infer<typeof albumRefSchema>) { await this.ready; const crate = this.data.crates.find((item) => item.id === id); if (!crate) return; crate.albums = crate.albums.filter((item) => !(item.source === value.source && item.albumId === value.albumId)); crate.albums.push({ ...value, addedAt: new Date().toISOString() }); await this.save(); return crate; }
  async removeFromCrate(id: string, source: Source, albumId: string) { await this.ready; const crate = this.data.crates.find((item) => item.id === id); if (!crate) return; crate.albums = crate.albums.filter((item) => !(item.source === source && item.albumId === albumId)); await this.save(); return crate; }
  async record(value: z.infer<typeof albumRefSchema>) { await this.ready; this.data.history.unshift({ source: value.source, albumId: value.albumId, title: value.title, artist: value.artist, playedAt: new Date().toISOString() }); this.data.history = this.data.history.slice(0, 500); await this.save(); }
  async history(source?: Source, albumId?: string) { await this.ready; return this.data.history.filter((item) => (!source || item.source === source) && (!albumId || item.albumId === albumId)); }
}

const moods: Record<string, string[]> = {
  atmospheric: ['ambient', 'atmospheric', 'dream', 'shoegaze', 'soundtrack', 'downtempo', 'trip hop', 'electronic'],
  calm: ['ambient', 'acoustic', 'classical', 'folk', 'chill', 'downtempo'],
  energetic: ['rock', 'dance', 'punk', 'metal', 'electronic', 'funk'],
  focused: ['ambient', 'classical', 'instrumental', 'minimal', 'soundtrack'],
  melancholy: ['soul', 'blues', 'folk', 'alternative', 'ambient'],
  joyful: ['pop', 'funk', 'disco', 'dance', 'soul']
};

function interpretGuide(query: string) {
  const text = query.toLocaleLowerCase();
  const decadeMatch = text.match(/(?:19|20)?(\d0)s\b/);
  const exactYear = text.match(/\b(19\d{2}|20\d{2})\b/);
  const decade = decadeMatch ? Number(`${Number(decadeMatch[1]) < 30 ? '20' : '19'}${decadeMatch[1]}`) : exactYear ? Math.floor(Number(exactYear[1]) / 10) * 10 : undefined;
  const mood = Object.keys(moods).find((key) => text.includes(key));
  const ignored = new Set(['play', 'find', 'show', 'give', 'me', 'some', 'something', 'music', 'album', 'albums', 'record', 'records', 'from', 'the', 'a', 'an', 'and', 'or', 'please', 'that', 'is', 'feels', 'for', 'in', 'on', mood ?? '']);
  const terms = text.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !ignored.has(word) && !/^\d{2,4}s?$/.test(word));
  return { decade, mood, terms, shouldPlay: /\b(play|put on|listen)\b/.test(text) };
}

function guideAlbums(query: string, albums: AlbumSummary[]) {
  const intent = interpretGuide(query);
  const ranked = albums.map((album) => {
    const haystack = `${album.artist} ${album.title} ${album.genres.join(' ')}`.toLocaleLowerCase();
    let score = Math.random() * .15;
    if (intent.decade) score += album.year && album.year >= intent.decade && album.year < intent.decade + 10 ? 5 : -4;
    if (intent.mood) score += (moods[intent.mood] ?? []).reduce((total, word) => total + (haystack.includes(word) ? 2 : 0), 0);
    score += intent.terms.reduce((total, word) => total + (haystack.includes(word) ? 2.5 : 0), 0);
    return { album, score };
  }).filter((item) => item.score > (intent.decade ? 0 : .1)).sort((a, b) => b.score - a.score).slice(0, 20).map((item) => item.album);
  const parts = [intent.mood && `${intent.mood} character`, intent.decade && `the ${intent.decade}s`, intent.terms.length && intent.terms.join(', ')].filter(Boolean);
  return { items: ranked.length ? ranked : albums.slice().sort(() => Math.random() - .5).slice(0, 20), interpretation: parts.length ? `Looking for ${parts.join(' · ')}.` : 'A varied selection from your collection.', shouldPlay: intent.shouldPlay };
}

async function allAlbums(source: Source, libraries: Record<Source, Library>) {
  const client = libraries[source];
  const items: AlbumSummary[] = [];
  let total = 1;
  const limit = source === 'spotify' ? 50 : 200;
  while (items.length < total && items.length < 2000) {
    const page = await client.albums(items.length, limit);
    items.push(...page.items); total = page.total;
    if (!page.items.length) break;
  }
  return items;
}

function relatedTo(album: AlbumDetail, albums: AlbumSummary[]) {
  return albums.filter((item) => item.id !== album.id).map((item) => {
    const sharedGenres = item.genres.filter((genre) => album.genres.some((value) => value.toLocaleLowerCase() === genre.toLocaleLowerCase())).length;
    const artist = item.artist.toLocaleLowerCase() === album.artist.toLocaleLowerCase() ? 5 : 0;
    const year = item.year && album.year ? Math.max(0, 2 - Math.abs(item.year - album.year) / 5) : 0;
    return { item, score: artist + sharedGenres * 2 + year };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(({ item }) => item);
}

export async function featureRoutes(app: FastifyInstance, { directory, jellyfin, spotify, plex, files, playback }: { directory: string; jellyfin: JellyfinClient; spotify: SpotifyClient; plex: PlexClient; files: FileLibrary; playback: JellyfinPlayback }) {
  const store = new FeatureStore(directory);
  const libraries: Record<Source, Library> = { jellyfin, spotify, plex, files };
  const library = (source: Source) => libraries[source];
  app.get('/guide', async (request) => { const { q, source } = z.object({ q: z.string().trim().min(2).max(300), source: sourceSchema }).parse(request.query); return guideAlbums(q, await allAlbums(source, libraries)); });
  app.get('/intelligence/:source/:id', async (request) => {
    const { source, id } = z.object({ source: sourceSchema, id: z.string().min(1).max(256) }).parse(request.params);
    const album = await library(source).album(id); const history = await store.history(source, id);
    const related = relatedTo(album, await allAlbums(source, libraries));
    return { album, related, listening: { plays: history.length, lastPlayedAt: history[0]?.playedAt }, context: album.year ? `Released in ${album.year}. ${album.tracks.length} tracks with a running time of ${Math.round(album.durationSeconds / 60)} minutes.` : `${album.tracks.length} tracks with a running time of ${Math.round(album.durationSeconds / 60)} minutes.`, credits: [...new Set(album.tracks.flatMap((track) => track.artist.split(', ')))], linerNotes: 'No publisher-supplied liner notes are present in the connected metadata for this edition.', note: 'Credits and context are drawn from your connected music metadata; SHELF never invents missing information.' };
  });
  app.get('/crates', async () => ({ items: await store.crates() }));
  app.post('/crates', async (request) => ({ item: await store.createCrate(z.object({ name: z.string().trim().min(1).max(60) }).parse(request.body).name) }));
  app.delete('/crates/:id', async (request, reply) => (await store.deleteCrate(z.string().uuid().parse((request.params as { id: string }).id))) ? { ok: true } : reply.code(404).send({ error: 'Crate not found' }));
  app.post('/crates/:id/albums', async (request, reply) => { const crate = await store.addToCrate(z.string().uuid().parse((request.params as { id: string }).id), albumRefSchema.parse(request.body)); return crate ? { item: crate } : reply.code(404).send({ error: 'Crate not found' }); });
  app.delete('/crates/:id/albums/:source/:albumId', async (request, reply) => { const { id, source, albumId } = z.object({ id: z.string().uuid(), source: sourceSchema, albumId: z.string().min(1).max(256) }).parse(request.params); const crate = await store.removeFromCrate(id, source, albumId); return crate ? { item: crate } : reply.code(404).send({ error: 'Crate not found' }); });
  app.post('/history', async (request) => { await store.record(albumRefSchema.parse(request.body)); return { ok: true }; });

  app.get('/control/v1/status', async (request) => { const source = sourceSchema.default('jellyfin').parse((request.query as { source?: string }).source); return { ok: true, source, playback: await (source === 'spotify' ? spotify.state() : playback.state()), timestamp: new Date().toISOString() }; });
  app.get('/control/v1/albums', async (request) => { const { source, q, limit } = z.object({ source: sourceSchema.default('jellyfin'), q: z.string().default(''), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query); const albums = await allAlbums(source, libraries); const term = q.trim().toLocaleLowerCase(); return { items: (term ? albums.filter((album) => `${album.artist} ${album.title}`.toLocaleLowerCase().includes(term)) : albums).slice(0, limit) }; });
  app.post('/control/v1/play', async (request) => { const value = z.object({ source: sourceSchema, albumId: z.string().min(1).max(256), trackId: z.string().min(1).max(256).optional() }).parse(request.body); const album = await library(value.source).album(value.albumId); const track = value.trackId ? album.tracks.find((item) => item.id === value.trackId) : album.tracks[0]; if (!track) throw new Error('Album has no playable tracks'); if (value.source === 'spotify') await spotify.playTrack(track.id, album.id); else if (value.source === 'plex') await playback.start(album.id, track.id, plex, plex.playerArtworkUrl(album.id)); else if (value.source === 'files') await playback.start(album.id, track.id, files, files.playerArtworkUrl(album.id)); else await playback.start(album.id, track.id); await store.record({ source: value.source, albumId: album.id, title: album.title, artist: album.artist, artworkUrl: album.artworkUrl }); return { ok: true, album: { id: album.id, title: album.title, artist: album.artist }, track: { id: track.id, title: track.title } }; });
  app.post('/control/v1/transport', async (request) => { const { source, action } = z.object({ source: sourceSchema, action: z.enum(['play', 'pause', 'next', 'previous', 'stop']) }).parse(request.body); if (source === 'spotify') { if (action === 'stop') await spotify.control('pause', {}); else await spotify.control(action, {}); } else await playback.control(action); return { ok: true }; });
  app.post('/control/v1/volume', async (request) => { const { source, volume } = z.object({ source: sourceSchema, volume: z.number().min(0).max(100) }).parse(request.body); if (source === 'spotify') await spotify.control('volume', { volume }); else await playback.control('volume', { volume }); return { ok: true, volume }; });
  app.get('/control/v1/openapi.json', async () => ({ openapi: '3.1.0', info: { title: 'SHELF Local Control API', version: '1.0.0', description: 'LAN-local controls for Home Assistant, Apple Shortcuts and trusted agents.' }, servers: [{ url: '/api/control/v1' }], paths: { '/status': { get: { summary: 'Read playback state' } }, '/albums': { get: { summary: 'Find albums' } }, '/play': { post: { summary: 'Play an album or track' } }, '/transport': { post: { summary: 'Play, pause, stop or skip' } }, '/volume': { post: { summary: 'Set volume from 0 to 100' } } } }));
}
