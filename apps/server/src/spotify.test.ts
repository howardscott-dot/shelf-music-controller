import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { SpotifyClient } from './spotify.js';
import { spotifyRoutes } from './spotify-routes.js';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const clientId = 'a'.repeat(32);
const albumId = 'a'.repeat(22);
const trackId = 't'.repeat(22);
const album = { id: albumId, name: 'A Real Album', artists: [{ name: 'An Artist' }], images: [{ url: 'https://i.scdn.co/image/cover', width: 640 }], release_date: '2024-01-01', tracks: { items: [{ id: trackId, name: 'Opening track', artists: [{ name: 'An Artist' }], track_number: 1, disc_number: 1, duration_ms: 180000 }], total: 1, next: null } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: 'user-library-read user-read-playback-state user-modify-playback-state' };
let directory: string;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let client: SpotifyClient;
const config = () => ({ SPOTIFY_CLIENT_ID: clientId, SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:8787/api/spotify/callback', SHELF_DATA_DIR: directory });

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'shelf-spotify-test-')); fetcher = vi.fn<typeof fetch>(); client = new SpotifyClient(config(), fetcher); });
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

async function connect(response = tokens) {
  fetcher.mockResolvedValueOnce(json(response));
  const auth = client.beginAuthorization();
  await client.finishAuthorization(new URL(auth.url).searchParams.get('state')!, auth.browser, 'test-code');
  fetcher.mockClear();
}

describe('Spotify PKCE and server-only credentials', () => {
  it('creates an S256 challenge with the minimum required scopes, without a secret', () => {
    const auth = client.beginAuthorization();
    const url = new URL(auth.url);
    expect(url.origin).toBe('https://accounts.spotify.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.get('state')).toHaveLength(64);
    expect(url.searchParams.has('client_secret')).toBe(false);
  });
  it('rejects mismatched browser binding and replayed callbacks', async () => {
    const auth = client.beginAuthorization();
    const state = new URL(auth.url).searchParams.get('state')!;
    await expect(client.finishAuthorization(state, 'wrong-browser', 'code')).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(json(tokens));
    await client.finishAuthorization(state, auth.browser, 'code');
    await expect(client.finishAuthorization(state, auth.browser, 'code')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('rejects an expired authorization and a denied permission', async () => {
    const expired = client.beginAuthorization();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 601_000);
    await expect(client.finishAuthorization(new URL(expired.url).searchParams.get('state')!, expired.browser, 'code')).rejects.toMatchObject({ statusCode: 400 });
    clock.mockRestore();
    const denied = client.beginAuthorization();
    await expect(client.finishAuthorization(new URL(denied.url).searchParams.get('state')!, denied.browser, undefined, 'access_denied')).rejects.toThrow('permission');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists credentials privately and never includes them in status', async () => {
    await connect();
    expect((await stat(join(directory, 'spotify.json'))).mode & 0o777).toBe(0o600);
    const status = await client.status();
    expect(status.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain('test-access');
    expect(JSON.stringify(status)).not.toContain('test-refresh');
    const restored = new SpotifyClient(config(), fetcher);
    expect((await restored.status()).connected).toBe(true);
    expect((await new SpotifyClient({ ...config(), SPOTIFY_CLIENT_ID: 'b'.repeat(32) }, fetcher).status()).connected).toBe(false);
  });
  it('coalesces simultaneous refreshes and persists rotated refresh tokens', async () => {
    await connect({ ...tokens, expires_in: 0 });
    fetcher.mockImplementation(async (url) => String(url).includes('/api/token') ? json({ ...tokens, access_token: 'renewed', refresh_token: 'rotated' }) : json({ devices: [] }));
    await Promise.all([client.devices(), client.devices()]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/api/token'))).toHaveLength(1);
    expect(JSON.parse(await readFile(join(directory, 'spotify.json'), 'utf8')).credentials.refreshToken).toBe('rotated');
  });
  it('forgets an invalid refresh grant and requests reconnect', async () => {
    await connect({ ...tokens, expires_in: 0 });
    fetcher.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    await expect(client.devices()).rejects.toMatchObject({ statusCode: 401 });
    expect((await client.status()).connected).toBe(false);
  });
  it('removes local credentials on disconnect without deleting anything at Spotify', async () => {
    await connect();
    await client.disconnect();
    expect((await client.status()).connected).toBe(false);
    expect(await readFile(join(directory, 'spotify.json'), 'utf8')).toBe('{}');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.albums(0, 20)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('cannot read previously cached albums after disconnecting', async () => {
    await connect(); fetcher.mockResolvedValueOnce(json({ items: [{ album }], total: 1 }));
    await client.albums(0, 20); await client.disconnect();
    await expect(client.albums(0, 20)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('Spotify library and playback', () => {
  it('maps real cover metadata without inventing physical spine or back scans', async () => {
    await connect();
    fetcher.mockResolvedValueOnce(json({ items: [{ album }], total: 1 }));
    const result = await client.albums(0, 20);
    expect(result.items[0]).toMatchObject({ source: 'spotify', title: album.name, artworkUrl: album.images[0]!.url, spineUrl: '', backArtworkUrl: '', externalUrl: `https://open.spotify.com/album/${albumId}` });
    await client.albums(0, 20);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('paginates album tracks rather than stopping at the first disc/page', async () => {
    await connect();
    fetcher.mockResolvedValueOnce(json({ ...album, tracks: { ...album.tracks, total: 2, next: 'https://api.spotify.com/next' } }));
    fetcher.mockResolvedValueOnce(json({ items: [{ ...album.tracks.items[0], id: 'u'.repeat(22), disc_number: 2 }], total: 2, next: null }));
    const result = await client.album(albumId);
    expect(result.tracks).toHaveLength(2);
    expect(result.durationSeconds).toBe(360);
    expect(String(fetcher.mock.calls[1]![0])).toContain(`/albums/${albumId}/tracks?offset=1&limit=50`);
  });
  it('caps catalogue search at the current ten-result API limit', async () => {
    await connect(); fetcher.mockResolvedValueOnce(json({ albums: { items: [album], total: 1200 } }));
    expect((await client.search('artist & album', 10)).total).toBe(1000);
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('q')).toBe('artist & album');
  });
  it('chooses a speaker without starting or transferring playback', async () => {
    await connect();
    fetcher.mockResolvedValueOnce(json({ devices: [{ id: 'wiim', name: 'WiiM Pro', is_active: false, is_restricted: false }] }));
    await client.selectDevice('wiim');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]?.method).toBe('GET');
    expect((await client.status()).deviceName).toBe('WiiM Pro');
  });
  it('requires an explicit device instead of unexpectedly playing on another speaker', async () => {
    await connect();
    await expect(client.control('play', {})).rejects.toMatchObject({ statusCode: 409 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('starts an album context on the selected speaker and uses real next/previous endpoints', async () => {
    await connect();
    fetcher.mockResolvedValueOnce(json({ devices: [{ id: 'wiim', name: 'WiiM', is_restricted: false }] })); await client.selectDevice('wiim');
    fetcher.mockResolvedValueOnce(json(album)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.playTrack(trackId, albumId);
    const play = fetcher.mock.calls.find(([url]) => String(url).includes('/me/player/play'))!;
    expect(String(play[0])).toContain('device_id=wiim');
    expect(JSON.parse(String(play[1]?.body))).toEqual({ context_uri: `spotify:album:${albumId}`, offset: { uri: `spotify:track:${trackId}` } });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })); await client.control('next', {});
    expect(String(fetcher.mock.lastCall![0])).toContain('/me/player/next?device_id=wiim');
    expect(fetcher.mock.lastCall![1]?.method).toBe('POST');
  });
  it('does not substitute the state of a different playing device', async () => {
    await connect();
    fetcher.mockResolvedValueOnce(json({ devices: [{ id: 'wiim', name: 'WiiM', is_restricted: false }] })); await client.selectDevice('wiim');
    fetcher.mockResolvedValueOnce(json({ device: { id: 'phone' }, is_playing: true }));
    expect(await client.state()).toMatchObject({ transport: 'STOPPED', deviceName: 'WiiM' });
  });
  it('maps idle 204 responses and shares playback polling between LAN clients', async () => {
    await connect(); fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const states = await Promise.all([client.state(), client.state()]);
    expect(states[0]?.transport).toBe('STOPPED'); await client.state();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('respects Retry-After without retry storms', async () => {
    await connect();
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(client.devices()).rejects.toMatchObject({ statusCode: 429, retryAfter: 120 });
    await expect(client.devices()).rejects.toMatchObject({ statusCode: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refreshes once on 401, without exposing upstream error bodies', async () => {
    await connect();
    fetcher.mockResolvedValueOnce(json({ secret: 'must-not-leak' }, 401)).mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json({ devices: [] }));
    expect((await client.devices()).devices).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('Spotify route boundaries', () => {
  it('completes a browser-bound callback without exposing tokens or authorization codes', async () => {
    const app = Fastify(); app.register(spotifyRoutes, { prefix: '/api/spotify', spotify: client });
    try {
      const start = await app.inject({ url: '/api/spotify/connect', headers: { host: '127.0.0.1:8787' } });
      const state = new URL(String(start.headers.location)).searchParams.get('state')!;
      const cookie = String(start.headers['set-cookie']).split(';')[0]!;
      fetcher.mockResolvedValueOnce(json(tokens));
      const callback = await app.inject({ url: `/api/spotify/callback?state=${state}&code=secret-code`, headers: { host: '127.0.0.1:8787', cookie } });
      expect(callback.statusCode).toBe(302); expect(callback.headers.location).toBe('/?spotify=connected');
      expect(JSON.stringify(callback.headers)).not.toContain('secret-code');
      expect((await client.status()).connected).toBe(true);
    } finally { await app.close(); }
  });
  it('keeps legacy health routes working and returns safe Spotify validation errors', async () => {
    const app = buildApp(loadConfig({ JELLYFIN_URL: 'http://jellyfin.invalid', JELLYFIN_API_KEY: 'test', JELLYFIN_USER_ID: 'test', WIIM_HOST: 'wiim.invalid', LOG_LEVEL: 'silent', SHELF_DATA_DIR: directory }));
    try {
      expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
      expect((await app.inject('/api/spotify/status')).json()).toMatchObject({ connected: false, configured: false });
      expect((await app.inject('/api/spotify/albums?limit=5000')).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/spotify/playback/volume', payload: { volume: 101 } })).statusCode).toBe(400);
      expect((await app.inject('/api/spotify/albums')).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/spotify/status', headers: { origin: 'https://unrelated.example' } })).headers['access-control-allow-origin']).toBeUndefined();
    } finally { await app.close(); }
  });
  it('sets a protected sign-in cookie and rejects a wrong callback origin', async () => {
    const app = Fastify(); app.register(spotifyRoutes, { prefix: '/api/spotify', spotify: client });
    try {
      const wrong = await app.inject({ url: '/api/spotify/connect', headers: { host: 'shelf.local:8787' } }); expect(wrong.statusCode).toBe(409);
      const result = await app.inject({ url: '/api/spotify/connect', headers: { host: '127.0.0.1:8787' } });
      expect(result.statusCode).toBe(302); expect(result.headers['set-cookie']).toContain('HttpOnly; SameSite=Lax');
      expect(result.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });
  it('rejects cross-origin control requests before making API calls', async () => {
    const app = Fastify(); app.register(spotifyRoutes, { prefix: '/api/spotify', spotify: client });
    try {
      const result = await app.inject({ method: 'POST', url: '/api/spotify/disconnect', headers: { host: 'shelf.local:8787', origin: 'https://other.example' }, payload: {} });
      expect(result.statusCode).toBe(403); expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('rejects insecure LAN callback addresses but accepts explicit loopback and HTTPS', () => {
    const base = { JELLYFIN_URL: 'http://jellyfin.local', JELLYFIN_API_KEY: 'test', JELLYFIN_USER_ID: 'test', WIIM_HOST: 'wiim.local' };
    expect(() => loadConfig({ ...base, SPOTIFY_REDIRECT_URI: 'http://shelf.local:8787/api/spotify/callback' })).toThrow();
    expect(() => loadConfig({ ...base, SPOTIFY_REDIRECT_URI: 'http://localhost:8787/api/spotify/callback' })).toThrow();
    expect(loadConfig(base).SPOTIFY_REDIRECT_URI).toBe(config().SPOTIFY_REDIRECT_URI);
    expect(loadConfig({ ...base, SPOTIFY_REDIRECT_URI: 'https://shelf.example/api/spotify/callback' }).SPOTIFY_REDIRECT_URI).toContain('https:');
  });
});
