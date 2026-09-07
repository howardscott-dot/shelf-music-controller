import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureRoutes } from './features.js';
import type { AlbumDetail } from './types.js';

const album: AlbumDetail = { source: 'jellyfin', id: 'a'.repeat(32), title: 'Blue Atmosphere', artist: 'Night Artist', year: 1996, genres: ['Ambient', 'Electronic'], artworkUrl: '/cover', backArtworkUrl: '', spineUrl: '', durationSeconds: 180, tracks: [{ id: 'b'.repeat(32), title: 'Clouds', artist: 'Night Artist', album: 'Blue Atmosphere', index: 1, disc: 1, durationSeconds: 180 }] };
let directory: string;
let app: ReturnType<typeof Fastify>;
let jellyfin: { albums: ReturnType<typeof vi.fn>; album: ReturnType<typeof vi.fn> };
let spotify: { albums: ReturnType<typeof vi.fn>; album: ReturnType<typeof vi.fn>; state: ReturnType<typeof vi.fn>; playTrack: ReturnType<typeof vi.fn>; control: ReturnType<typeof vi.fn> };
let playback: { state: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; control: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-features-'));
  jellyfin = { albums: vi.fn().mockResolvedValue({ items: [album], total: 1 }), album: vi.fn().mockResolvedValue(album) };
  spotify = { albums: vi.fn().mockResolvedValue({ items: [], total: 0 }), album: vi.fn(), state: vi.fn(), playTrack: vi.fn(), control: vi.fn() };
  playback = { state: vi.fn().mockResolvedValue({ transport: 'STOPPED' }), start: vi.fn(), control: vi.fn() };
  app = Fastify();
  await app.register(featureRoutes, { prefix: '/api', directory, jellyfin: jellyfin as never, spotify: spotify as never, playback: playback as never });
});
afterEach(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

describe('quiet intelligence features', () => {
  it('understands mood, era and a request to play', async () => {
    const response = await app.inject('/api/guide?source=jellyfin&q=play%20something%20atmospheric%20from%20the%201990s');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ shouldPlay: true, items: [{ id: album.id }] });
    expect(response.json().interpretation).toContain('atmospheric');
    expect(response.json().interpretation).toContain('1990s');
  });
  it('persists crates and prevents duplicate copies of a record', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/crates', payload: { name: 'Sunday Morning' } });
    const id = created.json().item.id;
    const payload = { source: 'jellyfin', albumId: album.id, title: album.title, artist: album.artist, artworkUrl: album.artworkUrl };
    await app.inject({ method: 'POST', url: `/api/crates/${id}/albums`, payload });
    await app.inject({ method: 'POST', url: `/api/crates/${id}/albums`, payload });
    const crates = await app.inject('/api/crates');
    expect(crates.json().items[0]).toMatchObject({ name: 'Sunday Morning', albums: [{ albumId: album.id }] });
    expect(crates.json().items[0].albums).toHaveLength(1);
  });
  it('offers automation-friendly playback and a self-describing API', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/control/v1/play', payload: { source: 'jellyfin', albumId: album.id } });
    expect(result.json()).toMatchObject({ ok: true, album: { title: album.title }, track: { title: 'Clouds' } });
    expect(playback.start).toHaveBeenCalledWith(album.id, album.tracks[0]!.id);
    const description = await app.inject('/api/control/v1/openapi.json');
    expect(description.json().paths).toHaveProperty('/transport');
  });
  it('reports only grounded metadata and listening history in the album drawer', async () => {
    await app.inject({ method: 'POST', url: '/api/history', payload: { source: 'jellyfin', albumId: album.id, title: album.title, artist: album.artist } });
    const result = await app.inject(`/api/intelligence/jellyfin/${album.id}`);
    expect(result.json()).toMatchObject({ listening: { plays: 1 }, credits: ['Night Artist'] });
    expect(result.json().context).toContain('Released in 1996');
  });
});
