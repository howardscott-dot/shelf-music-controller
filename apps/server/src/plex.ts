import type { FastifyInstance } from 'fastify';
import type { AlbumDetail, AlbumSummary, Track } from './types.js';
import { z } from 'zod';

type PlexGenre = { tag?: string };
type PlexPart = { key?: string; duration?: number };
type PlexMedia = { Part?: PlexPart[] };
type PlexItem = {
  ratingKey?: string; key?: string; title?: string; parentTitle?: string; grandparentTitle?: string;
  year?: number; duration?: number; thumb?: string; Genre?: PlexGenre[]; index?: number; parentIndex?: number; Media?: PlexMedia[];
};
type PlexContainer = { MediaContainer?: { Metadata?: PlexItem[]; Directory?: Array<{ key?: string; title?: string; type?: string }>; totalSize?: number; size?: number } };

export class PlexClient {
  private readonly base?: URL;
  private readonly partByTrack = new Map<string, string>();
  private readonly artworkByAlbum = new Map<string, string>();
  private section?: string;
  constructor(url?: string, private readonly token?: string, section?: string, private readonly fetcher: typeof fetch = fetch) {
    this.base = url ? new URL(url.endsWith('/') ? url : `${url}/`) : undefined;
    this.section = section || undefined;
  }
  get configured() { return Boolean(this.base && this.token); }
  private requireConfig() { if (!this.base || !this.token) throw new Error('Plex is not configured on this SHELF server.'); }
  private url(path: string) { this.requireConfig(); return new URL(path.replace(/^\//, ''), this.base); }
  private async request<T = PlexContainer>(path: string, search: Record<string, string | number> = {}): Promise<T> {
    const url = this.url(path);
    for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));
    const response = await this.fetcher(url, { headers: { Accept: 'application/json', 'X-Plex-Token': this.token!, 'X-Plex-Client-Identifier': 'shelf-music-controller', 'X-Plex-Product': 'SHELF' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Plex request failed (${response.status}). Check the server address, token and music library.`);
    return response.json() as Promise<T>;
  }
  private async sectionId() {
    if (this.section) return this.section;
    const result = await this.request('/library/sections');
    const music = result.MediaContainer?.Directory?.find((item) => item.type === 'artist');
    if (!music?.key) throw new Error('Plex has no music library. Create one or set PLEX_MUSIC_LIBRARY_ID.');
    this.section = music.key;
    return this.section;
  }
  async status() {
    if (!this.configured) return { configured: false };
    try { return { configured: true, connected: true, libraryId: await this.sectionId() }; }
    catch (error) { return { configured: true, connected: false, error: error instanceof Error ? error.message : 'Plex is unavailable' }; }
  }
  private summary(item: PlexItem): AlbumSummary {
    const id = String(item.ratingKey ?? '').trim();
    if (!id) throw new Error('Plex returned an album without an identifier.');
    if (item.thumb) this.artworkByAlbum.set(id, item.thumb);
    return {
      source: 'plex', id, title: item.title || 'Untitled album', artist: item.parentTitle || 'Unknown artist', year: item.year,
      genres: item.Genre?.map((genre) => genre.tag).filter((value): value is string => Boolean(value)) ?? [],
      artworkUrl: `/api/plex/artwork/${encodeURIComponent(id)}?width=1200`, thumbnailUrl: `/api/plex/artwork/${encodeURIComponent(id)}?width=360`, backArtworkUrl: '', spineUrl: `/api/plex/artwork/${encodeURIComponent(id)}?width=1200`
    };
  }
  async albums(start = 0, limit = 100) {
    const result = await this.request(`/library/sections/${encodeURIComponent(await this.sectionId())}/albums`, { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': limit, sort: 'artist.titleSort,album.titleSort' });
    const items = (result.MediaContainer?.Metadata ?? []).map((item) => this.summary(item));
    return { items, total: result.MediaContainer?.totalSize ?? items.length };
  }
  async album(id: string): Promise<AlbumDetail> {
    const [metadata, children] = await Promise.all([
      this.request(`/library/metadata/${encodeURIComponent(id)}`),
      this.request(`/library/metadata/${encodeURIComponent(id)}/children`)
    ]);
    const album = metadata.MediaContainer?.Metadata?.[0];
    if (!album) throw new Error('Plex album not found.');
    const summary = this.summary(album);
    const tracks = (children.MediaContainer?.Metadata ?? []).map((item, offset): Track => {
      const trackId = String(item.ratingKey ?? '').trim();
      const part = item.Media?.[0]?.Part?.[0]?.key;
      if (trackId && part) this.partByTrack.set(trackId, part);
      return { id: trackId, title: item.title || `Track ${offset + 1}`, artist: item.grandparentTitle || summary.artist, album: summary.title, index: item.index ?? offset + 1, disc: item.parentIndex ?? 1, durationSeconds: Math.round((item.duration ?? 0) / 1000) };
    }).filter((track) => track.id && this.partByTrack.has(track.id));
    return { ...summary, tracks, durationSeconds: tracks.reduce((total, track) => total + track.durationSeconds, 0) };
  }
  streamUrl(trackId: string) {
    const path = this.partByTrack.get(trackId);
    if (!path) throw new Error('Open the Plex album again before starting this track.');
    const url = this.url(path); url.searchParams.set('X-Plex-Token', this.token!); return url.toString();
  }
  playerArtworkUrl(albumId: string) {
    const path = this.artworkByAlbum.get(albumId);
    if (!path) return '';
    const url = this.url(path); url.searchParams.set('X-Plex-Token', this.token!); url.searchParams.set('width', '720'); return url.toString();
  }
  async artwork(id: string, width: number) {
    let path = this.artworkByAlbum.get(id);
    if (!path) {
      const metadata = await this.request(`/library/metadata/${encodeURIComponent(id)}`);
      const item = metadata.MediaContainer?.Metadata?.[0]; path = item?.thumb;
      if (path) this.artworkByAlbum.set(id, path);
    }
    if (!path) return undefined;
    const url = this.url(path); url.searchParams.set('width', String(width));
    return this.fetcher(url, { headers: { 'X-Plex-Token': this.token! }, signal: AbortSignal.timeout(10_000) });
  }
}

export async function plexRoutes(app: FastifyInstance, { plex, playback }: { plex: PlexClient; playback: { state: () => Promise<unknown>; start: (albumId: string, trackId: string, library: PlexClient, artwork: string) => Promise<unknown>; control: (action: string, body?: { positionSeconds?: number; volume?: number; muted?: boolean }) => Promise<unknown> } }) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') return;
    let other = false; try { other = !!request.headers.origin && new URL(request.headers.origin).host !== request.headers.host; } catch { other = true; }
    if (request.headers['sec-fetch-site'] === 'cross-site' || other) return reply.code(403).send({ error: 'Playback controls must be used from SHELF on this server.' });
  });
  app.get('/status', async () => plex.status());
  app.get('/albums', async (request) => { const query = request.query as { start?: string; limit?: string }; return plex.albums(Number(query.start ?? 0), Math.min(200, Number(query.limit ?? 100))); });
  app.get('/albums/:id', async (request) => plex.album((request.params as { id: string }).id));
  app.get('/artwork/:id', async (request, reply) => {
    const width = Math.max(64, Math.min(1600, Number((request.query as { width?: string }).width ?? 720)));
    const response = await plex.artwork((request.params as { id: string }).id, width);
    if (!response?.ok) return reply.code(response?.status ?? 404).send({ error: 'Plex artwork unavailable' });
    reply.header('Content-Type', response.headers.get('content-type') ?? 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });
  app.get('/playback', async () => playback.state());
  app.post('/playback/track/:id', async (request) => {
    const trackId = z.string().min(1).max(256).parse((request.params as { id: string }).id);
    const albumId = z.object({ albumId: z.string().min(1).max(256) }).parse(request.body).albumId;
    await playback.start(albumId, trackId, plex, plex.playerArtworkUrl(albumId)); return { ok: true };
  });
  app.post('/playback/:action', async (request) => {
    const action = z.enum(['play', 'pause', 'stop', 'seek', 'volume', 'mute', 'next', 'previous']).parse((request.params as { action: string }).action);
    const body = z.object({ positionSeconds: z.number().finite().min(0).max(86400).optional(), volume: z.number().finite().min(0).max(100).optional(), muted: z.boolean().optional() }).parse(request.body ?? {});
    if (action === 'seek') z.number().parse(body.positionSeconds); if (action === 'volume') z.number().parse(body.volume); if (action === 'mute') z.boolean().parse(body.muted);
    await playback.control(action, body); return { ok: true };
  });
}
