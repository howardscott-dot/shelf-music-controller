import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { AlbumDetail, AlbumSummary, PlaybackState, Track } from './types.js';

const API = 'https://api.spotify.com/v1';
const SCOPES = ['user-library-read', 'user-read-playback-state', 'user-modify-playback-state'];
type Page<T> = { items: T[]; total: number; next?: string | null };
type SpotifyAlbum = { id: string; name: string; artists: { name: string }[]; images: { url: string; width?: number }[]; release_date?: string; tracks?: Page<SpotifyTrack> };
type SpotifyTrack = { id: string; name: string; artists: { name: string }[]; track_number: number; disc_number: number; duration_ms: number; album?: SpotifyAlbum };
type Device = { id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean; supports_volume?: boolean; volume_percent: number | null };
type Credentials = { accessToken: string; refreshToken: string; expiresAt: number; clientId: string };
type Stored = { credentials?: Credentials; deviceId?: string; deviceName?: string };
type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

export class SpotifyError extends Error {
  constructor(message: string, public statusCode = 502, public retryAfter?: number) { super(message); }
}

export class SpotifyClient {
  private data: Stored = {};
  private ready: Promise<void>;
  private refreshing?: Promise<string>;
  private writing: Promise<void> = Promise.resolve();
  private pending = new Map<string, { verifier: string; browser: string; expires: number }>();
  private cooldown = 0;
  private stateCache?: { value: PlaybackState; expires: number };
  private stateRequest?: Promise<PlaybackState>;
  private albumCache = new Map<string, { value: AlbumDetail; expires: number }>();
  private libraryCache = new Map<string, { value: { items: AlbumSummary[]; total: number }; expires: number }>();
  private volumeBeforeMute = 30;
  private readonly file: string;
  private generation = 0;

  constructor(private config: Pick<Config, 'SPOTIFY_CLIENT_ID' | 'SPOTIFY_REDIRECT_URI' | 'SHELF_DATA_DIR'>, private fetcher: typeof fetch = fetch) {
    this.file = join(config.SHELF_DATA_DIR, 'spotify.json');
    this.ready = this.restore();
  }

  get configured() { return Boolean(this.config.SPOTIFY_CLIENT_ID); }
  get redirectUri() { return this.config.SPOTIFY_REDIRECT_URI; }

  private async restore() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as Stored;
      if (saved.credentials?.clientId === this.config.SPOTIFY_CLIENT_ID && typeof saved.credentials?.refreshToken === 'string') this.data = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new SpotifyError('Cannot read Spotify connection data. Check the server data directory.');
    }
  }

  private async save() {
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await mkdir(this.config.SHELF_DATA_DIR, { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
    });
    await this.writing;
  }

  async status() {
    await this.ready;
    return { configured: this.configured, connected: Boolean(this.data.credentials), connectUrl: new URL('/api/spotify/connect', this.redirectUri).toString(), deviceId: this.data.deviceId, deviceName: this.data.deviceName };
  }

  beginAuthorization() {
    if (!this.configured) throw new SpotifyError('Spotify needs a Client ID in the server settings before connecting.', 503);
    const now = Date.now();
    for (const [key, value] of this.pending) if (value.expires < now) this.pending.delete(key);
    if (this.pending.size >= 20) throw new SpotifyError('Too many sign-in attempts. Try again in ten minutes.', 429, 600);
    const state = randomBytes(32).toString('hex');
    const browser = randomBytes(32).toString('hex');
    const verifier = randomBytes(64).toString('base64url');
    this.pending.set(state, { verifier, browser, expires: now + 600_000 });
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ client_id: this.config.SPOTIFY_CLIENT_ID!, response_type: 'code', redirect_uri: this.redirectUri,
      scope: SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    return { url: url.toString(), browser };
  }

  async finishAuthorization(state: string, browser: string, code?: string, denied?: string) {
    await this.ready;
    const pending = this.pending.get(state);
    if (!pending || pending.expires < Date.now() || !browser || pending.browser !== browser) throw new SpotifyError('Spotify sign-in expired or was opened in a different browser. Please connect again.', 400);
    this.pending.delete(state);
    if (denied || !code) throw new SpotifyError('Spotify permission was not granted. You can connect again whenever you are ready.', 400);
    const generation = this.generation;
    const tokens = await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: pending.verifier });
    if (generation !== this.generation) throw new SpotifyError('Spotify connection changed during sign-in. Please connect again.', 401);
    if (!tokens.refresh_token) throw new SpotifyError('Spotify did not return a renewable connection. Please connect again.', 401);
    if (tokens.scope && SCOPES.some((scope) => !tokens.scope!.split(' ').includes(scope))) throw new SpotifyError('Please allow both library access and playback control when connecting Spotify.', 403);
    this.data = { credentials: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, clientId: this.config.SPOTIFY_CLIENT_ID! } };
    this.clearCaches();
    await this.save();
  }

  private async exchange(values: Record<string, string>): Promise<TokenResponse> {
    const response = await this.fetcher('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...values, client_id: this.config.SPOTIFY_CLIENT_ID! }), signal: AbortSignal.timeout(10_000) });
    if (response.status === 429) this.rateLimited(response);
    if (!response.ok) throw new SpotifyError(response.status === 400 || response.status === 401 ? 'Spotify connection has expired. Please reconnect your account.' : 'Spotify sign-in is temporarily unavailable. Try again shortly.', response.status === 400 || response.status === 401 ? 401 : 502);
    const tokens = await response.json() as TokenResponse;
    if (!tokens.access_token || !Number.isFinite(tokens.expires_in)) throw new SpotifyError('Spotify returned an incomplete sign-in response. Please try again.');
    return tokens;
  }

  private async token() {
    await this.ready;
    const credentials = this.data.credentials;
    if (!credentials) throw new SpotifyError('Connect your Spotify account from the source screen.', 401);
    if (Date.now() < this.cooldown) throw new SpotifyError('Spotify is limiting requests. Please try again shortly.', 429, Math.ceil((this.cooldown - Date.now()) / 1000));
    if (Date.now() < credentials.expiresAt - 60_000) return credentials.accessToken;
    if (!this.refreshing) this.refreshing = (async () => {
      try {
        const next = await this.exchange({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken });
        // Do not resurrect credentials if the account was disconnected during refresh.
        if (this.data.credentials !== credentials) throw new SpotifyError('Spotify connection changed. Please try again.', 401);
        this.data.credentials = { ...credentials, accessToken: next.access_token, refreshToken: next.refresh_token ?? credentials.refreshToken, expiresAt: Date.now() + next.expires_in * 1000 };
        await this.save();
        return next.access_token;
      } catch (error) {
        if (error instanceof SpotifyError && error.statusCode === 401 && this.data.credentials === credentials) { this.data = {}; this.clearCaches(); await this.save(); }
        throw error;
      }
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private rateLimited(response: Response): never {
    const seconds = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
    this.cooldown = Date.now() + delay * 1000;
    throw new SpotifyError('Spotify is limiting requests. SHELF will wait before trying again.', 429, Math.ceil(delay));
  }

  private async request<T>(path: string, method = 'GET', body?: object, retry = true): Promise<T> {
    if (Date.now() < this.cooldown) throw new SpotifyError('Spotify is limiting requests. Please try again shortly.', 429, Math.ceil((this.cooldown - Date.now()) / 1000));
    const token = await this.token();
    const response = await this.fetcher(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12_000) });
    if (response.status === 401 && retry) {
      if (this.data.credentials?.accessToken === token) this.data.credentials.expiresAt = 0;
      return this.request(path, method, body, false);
    }
    if (response.status === 429) this.rateLimited(response);
    if (!response.ok) {
      if (response.status === 401) throw new SpotifyError('Please reconnect Spotify from the source screen.', 401);
      if (response.status === 403) throw new SpotifyError('Spotify denied this action. Check Premium, the app user allowlist, and the selected device.', 403);
      if (response.status === 404) throw new SpotifyError('Spotify could not find that item or device. For playback, open Spotify, select the WiiM, then refresh devices in SHELF.', 404);
      throw new SpotifyError('Spotify is temporarily unavailable. Please try again shortly.');
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  }

  private clearCaches() { this.generation += 1; this.stateCache = undefined; this.stateRequest = undefined; this.albumCache.clear(); this.libraryCache.clear(); }
  private async requireConnection() {
    await this.ready;
    if (!this.data.credentials) throw new SpotifyError('Connect your Spotify account from the source screen.', 401);
  }
  async disconnect() { await this.ready; this.data = {}; this.pending.clear(); this.clearCaches(); await this.save(); }

  private summary(album: SpotifyAlbum): AlbumSummary {
    return { source: 'spotify', id: album.id, title: album.name, artist: album.artists.map((artist) => artist.name).join(', '),
      year: album.release_date ? Number(album.release_date.slice(0, 4)) : undefined, genres: [], artworkUrl: album.images[0]?.url ?? '',
      backArtworkUrl: '', spineUrl: '', externalUrl: `https://open.spotify.com/album/${album.id}` };
  }

  async albums(start: number, limit: number) {
    await this.requireConnection();
    const generation = this.generation;
    const key = `${start}:${limit}`;
    const cached = this.libraryCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const result = await this.request<Page<{ album: SpotifyAlbum }>>(`/me/albums?offset=${start}&limit=${limit}`);
    const value = { items: result.items.filter((item) => item.album).map((item) => this.summary(item.album)), total: result.total };
    if (generation === this.generation) this.libraryCache.set(key, { value, expires: Date.now() + 60_000 });
    return value;
  }

  async search(query: string, start: number) {
    const result = await this.request<{ albums: Page<SpotifyAlbum> }>(`/search?${new URLSearchParams({ q: query, type: 'album', limit: '10', offset: String(start) })}`);
    return { items: result.albums.items.map((album) => this.summary(album)), total: Math.min(result.albums.total, 1000) };
  }

  async album(id: string): Promise<AlbumDetail> {
    await this.requireConnection();
    const generation = this.generation;
    const cached = this.albumCache.get(id);
    if (cached && cached.expires > Date.now()) return cached.value;
    const album = await this.request<SpotifyAlbum>(`/albums/${id}`);
    const all = [...(album.tracks?.items ?? [])];
    let more = album.tracks?.next;
    while (more && all.length < (album.tracks?.total ?? 0)) {
      const page = await this.request<Page<SpotifyTrack>>(`/albums/${id}/tracks?offset=${all.length}&limit=50`);
      if (!page.items.length) break;
      all.push(...page.items); more = page.next;
    }
    const tracks: Track[] = all.map((track) => ({ id: track.id, title: track.name, artist: track.artists.map((artist) => artist.name).join(', '), album: album.name, index: track.track_number, disc: track.disc_number, durationSeconds: track.duration_ms / 1000 }));
    const value = { ...this.summary(album), tracks, durationSeconds: tracks.reduce((total, track) => total + track.durationSeconds, 0) };
    if (this.albumCache.size >= 100) this.albumCache.delete(this.albumCache.keys().next().value!);
    if (generation === this.generation) this.albumCache.set(id, { value, expires: Date.now() + 300_000 });
    return value;
  }

  async devices() {
    const result = await this.request<{ devices: Device[] }>('/me/player/devices');
    return { devices: result.devices.filter((device) => device.id).map((device) => ({ id: device.id!, name: device.name, active: device.is_active, restricted: device.is_restricted })), selectedId: this.data.deviceId };
  }

  async selectDevice(id: string) {
    const { devices } = await this.devices();
    const device = devices.find((candidate) => candidate.id === id && !candidate.restricted);
    if (!device) throw new SpotifyError('That Spotify device is unavailable. Refresh devices and choose again.', 400);
    // Choosing a target does not interrupt any music already playing.
    this.data.deviceId = device.id; this.data.deviceName = device.name;
    this.stateCache = undefined;
    await this.save();
  }

  private async target() {
    await this.ready;
    if (!this.data.deviceId) throw new SpotifyError('Choose your WiiM in Spotify devices before starting playback.', 409);
    return `device_id=${encodeURIComponent(this.data.deviceId)}`;
  }

  async playTrack(trackId: string, albumId: string) {
    const album = await this.album(albumId);
    if (!album.tracks.some((track) => track.id === trackId)) throw new SpotifyError('This track does not belong to the selected album.', 400);
    await this.request(`/me/player/play?${await this.target()}`, 'PUT', { context_uri: `spotify:album:${albumId}`, offset: { uri: `spotify:track:${trackId}` } });
    this.stateCache = undefined;
  }

  async control(action: string, body: { positionSeconds?: number; volume?: number; muted?: boolean; enabled?: boolean }) {
    const target = await this.target();
    if (action === 'play' || action === 'pause') await this.request(`/me/player/${action}?${target}`, 'PUT');
    else if (action === 'next' || action === 'previous') await this.request(`/me/player/${action}?${target}`, 'POST');
    else if (action === 'seek' && body.positionSeconds !== undefined) await this.request(`/me/player/seek?${target}&position_ms=${Math.round(body.positionSeconds * 1000)}`, 'PUT');
    else if (action === 'shuffle' && body.enabled !== undefined) await this.request(`/me/player/shuffle?${target}&state=${body.enabled}`, 'PUT');
    else if (action === 'volume' && body.volume !== undefined) await this.request(`/me/player/volume?${target}&volume_percent=${Math.round(body.volume)}`, 'PUT');
    else if (action === 'mute' && body.muted !== undefined) {
      if (body.muted) this.volumeBeforeMute = (await this.state()).volume || this.volumeBeforeMute;
      await this.request(`/me/player/volume?${target}&volume_percent=${body.muted ? 0 : this.volumeBeforeMute}`, 'PUT');
    } else throw new SpotifyError('Unknown or incomplete Spotify control.', 400);
    this.stateCache = undefined;
  }

  async state(): Promise<PlaybackState> {
    await this.requireConnection();
    const generation = this.generation;
    if (this.stateCache && this.stateCache.expires > Date.now()) return this.stateCache.value;
    if (this.stateRequest) return this.stateRequest;
    this.stateRequest = (async () => {
      const response = await this.request<{ is_playing: boolean; progress_ms: number; item?: SpotifyTrack; currently_playing_type: string; device: Device; shuffle_state: boolean; actions?: { disallows?: Record<string, boolean> } } | undefined>('/me/player');
      const idle: PlaybackState = { transport: 'STOPPED', positionSeconds: 0, durationSeconds: 0, volume: 0, muted: false, supportsVolume: false, deviceName: this.data.deviceName };
      // Never show another device's state while controls target the chosen WiiM.
      if (!response || (this.data.deviceId && response.device.id !== this.data.deviceId)) return idle;
      const track = response.currently_playing_type === 'track' ? response.item : undefined;
      return { transport: response.is_playing ? 'PLAYING' : 'PAUSED_PLAYBACK', trackId: track?.id, albumId: track?.album?.id,
        title: track?.name, artist: track?.artists.map((artist) => artist.name).join(', '), album: track?.album?.name, artworkUrl: track?.album?.images[0]?.url,
        durationSeconds: (track?.duration_ms ?? 0) / 1000, positionSeconds: (response.progress_ms ?? 0) / 1000,
        volume: response.device.volume_percent ?? 0, muted: response.device.volume_percent === 0, deviceName: response.device.name,
        shuffle: response.shuffle_state, supportsVolume: response.device.supports_volume !== false, disallows: response.actions?.disallows,
        externalUrl: track ? `https://open.spotify.com/track/${track.id}` : undefined } satisfies PlaybackState;
    })();
    const pending = this.stateRequest;
    try { const value = await pending; if (generation === this.generation) this.stateCache = { value, expires: Date.now() + 4000 }; return value; }
    finally { if (this.stateRequest === pending) this.stateRequest = undefined; }
  }
}
