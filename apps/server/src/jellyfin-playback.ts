import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlbumDetail, PlaybackState } from './types.js';
import type { WiimClient, WiimTransportState } from './wiim.js';
import type { JellyfinClient } from './jellyfin.js';

type Player = Pick<WiimClient, 'setUri' | 'setNextUri' | 'play' | 'pause' | 'stop' | 'seek' | 'setVolume' | 'setMute' | 'transportState' | 'state'> & { supportsNextUri?: () => boolean | undefined };
type Library = Pick<JellyfinClient, 'album' | 'streamUrl'>;
interface Queue { album: AlbumDetail; index: number; prepared?: number; startingUntil: number; stoppedSince?: number; naturalEndSince?: number; library?: Library; artworkUri?: string; nativeNext?: boolean; lastTransport?: PlaybackState['transport']; lastPosition?: number; lastDuration?: number }

/** The WiiM performs each transition. This server keeps its next-URI buffer
 * filled, independent of browser tabs, iPad sleep and the viewed album.
 * Crucially, observing STOPPED never sends Play: external stops stay stopped. */
export class JellyfinPlayback {
  private queue?: Queue;
  private serial: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private warning?: string;
  constructor(private readonly wiim: Player, private readonly library: Library, private readonly artworkUri: (id: string) => string, private readonly interval = 1000) {}

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.serial.then(task);
    this.serial = result.catch(() => undefined);
    return result;
  }
  private schedule(delay = this.interval) {
    clearTimeout(this.timer);
    if (this.closed || !this.queue) return;
    this.timer = setTimeout(() => {
      void this.tick().catch(() => { this.warning = 'SHELF could not refresh the WiiM album queue. Check the speaker connection.'; }).finally(() => {
        const stopped = this.queue?.stoppedSince;
        this.schedule(stopped && Date.now() - stopped >= 15_000 ? 5000 : this.warning ? 3000 : this.interval);
      });
    }, delay);
    this.timer.unref();
  }
  async close() { this.closed = true; clearTimeout(this.timer); await this.serial; }

  private indexFor(queue: Queue, uri?: string): number {
    if (!uri || uri === 'NOT_IMPLEMENTED') return -1;
    try {
      const current = new URL(uri);
      return queue.album.tracks.findIndex((track) => {
        const expected = new URL((queue.library ?? this.library).streamUrl(track.id));
        return current.origin === expected.origin && current.pathname.toLowerCase() === expected.pathname.toLowerCase();
      });
    } catch { return -1; }
  }
  private async prepare(queue: Queue) {
    const library = queue.library ?? this.library;
    const nextIndex = queue.index + 1;
    if (queue.prepared === nextIndex) return;
    const next = queue.album.tracks[nextIndex];
    await this.wiim.setNextUri(next ? library.streamUrl(next.id) : '', next, next ? (queue.artworkUri ?? this.artworkUri(queue.album.id)) : '');
    queue.nativeNext = this.wiim.supportsNextUri?.() !== false;
    queue.prepared = nextIndex;
    this.warning = undefined;
  }
  private async load(queue: Queue, index: number) {
    const library = queue.library ?? this.library;
    const track = queue.album.tracks[index];
    if (!track) throw new Error('Track does not belong to album');
    // Invalidate the previous queue before any command can partially succeed.
    this.queue = undefined; clearTimeout(this.timer);
    queue.index = index; queue.prepared = undefined; queue.stoppedSince = undefined; queue.naturalEndSince = undefined;
    queue.lastTransport = undefined; queue.lastPosition = undefined; queue.lastDuration = undefined;
    queue.startingUntil = Date.now() + 5000;
    await this.wiim.setUri(library.streamUrl(track.id), track, queue.artworkUri ?? this.artworkUri(queue.album.id));
    try { await this.prepare(queue); await this.wiim.play(); }
    catch {
      await this.wiim.stop().catch(() => undefined);
      await this.wiim.setNextUri('').catch(() => undefined);
      throw new Error('WiiM could not prepare continuous album playback. Please try again.');
    }
    this.queue = queue;
    this.warning = undefined;
    this.schedule();
  }
  async start(albumId: string, trackId: string, library: Library = this.library, artworkUri?: string) {
    return this.exclusive(async () => {
      const album = await library.album(albumId);
      const index = album.tracks.findIndex((track) => track.id === trackId);
      if (index < 0) throw new Error('Track does not belong to album');
      await this.load({ album, index, startingUntil: 0, library, artworkUri }, index);
    });
  }

  async release() {
    return this.exclusive(async () => { this.queue = undefined; clearTimeout(this.timer); this.warning = undefined; });
  }

  private observe(state: WiimTransportState): Queue | undefined {
    const queue = this.queue;
    if (!queue) return undefined;
    const index = this.indexFor(queue, state.trackUri);
    if (index < 0) {
      // Some renderers temporarily omit the URI during a transition. Never
      // enqueue against an unidentified source, nor clear another app's queue.
      if (state.trackUri && state.trackUri !== 'NOT_IMPLEMENTED' && Date.now() >= queue.startingUntil) {
        this.queue = undefined; clearTimeout(this.timer); this.warning = undefined;
      }
      return undefined;
    }
    if (index !== queue.index && index !== queue.index + 1 && Date.now() < queue.startingUntil) return undefined;
    queue.startingUntil = 0;
    if (index !== queue.index) { queue.index = index; queue.prepared = undefined; queue.naturalEndSince = undefined; }
    if (state.transport === 'STOPPED') queue.stoppedSince ??= Date.now();
    else queue.stoppedSince = undefined;
    return queue;
  }

  async tick() {
    return this.exclusive(async () => {
      if (this.closed || !this.queue) return;
      const state = await this.wiim.transportState();
      const queue = this.observe(state);
      if (!queue) return;
      const stoppedAtNaturalEnd = state.transport === 'STOPPED' && queue.lastTransport === 'PLAYING'
        && Boolean(queue.lastDuration && queue.lastPosition !== undefined && queue.lastPosition >= queue.lastDuration - 10);
      if (stoppedAtNaturalEnd) queue.naturalEndSince ??= Date.now();
      if (state.transport !== 'STOPPED') queue.naturalEndSince = undefined;
      // Some Linkplay/WiiM firmware accepts SetNextAVTransportURI but does not
      // actually consume it for every HTTP stream. Give a genuine native
      // transition a short window, then safely advance the server-owned album.
      const nativeTransitionMissed = queue.naturalEndSince !== undefined
        && (queue.nativeNext === false || Date.now() - queue.naturalEndSince >= 2500);
      if (nativeTransitionMissed && queue.index + 1 < queue.album.tracks.length) { await this.load(queue, queue.index + 1); return; }
      queue.lastTransport = state.transport; queue.lastPosition = state.positionSeconds; queue.lastDuration = state.durationSeconds || queue.album.tracks[queue.index]?.durationSeconds;
      if (state.transport === 'PLAYING' || state.transport === 'PAUSED_PLAYBACK') await this.prepare(queue);
    });
  }

  async state(): Promise<PlaybackState> {
    const { trackUri, ...state } = await this.wiim.state();
    const queue = this.queue;
    const index = queue ? this.indexFor(queue, trackUri) : -1;
    // Stream URLs contain Jellyfin credentials and are internal-only.
    const result: PlaybackState = { ...state, disallows: { skipping_next: !queue || index < 0 || index >= queue.album.tracks.length - 1, skipping_prev: !queue || index < 0 } };
    if (queue && index >= 0) {
      const track = queue.album.tracks[index]!;
      Object.assign(result, { trackId: track.id, albumId: queue.album.id, title: track.title, artist: track.artist, album: queue.album.title, artworkUrl: queue.album.artworkUrl, durationSeconds: state.durationSeconds || track.durationSeconds, queueIndex: index, queueLength: queue.album.tracks.length });
      if (this.warning) result.queueWarning = this.warning;
    }
    // Even when another app owns the speaker, don't forward image credentials.
    if (result.artworkUrl) {
      try { const url = new URL(result.artworkUrl); if (['api_key', 'X-Plex-Token', 'token'].some((key) => url.searchParams.has(key))) result.artworkUrl = undefined; } catch { /* Relative SHELF artwork URL. */ }
    }
    return result;
  }

  async control(action: string, body: { positionSeconds?: number; volume?: number; muted?: boolean } = {}) {
    return this.exclusive(async () => {
      if (action === 'volume') { await this.wiim.setVolume(body.volume!); return; }
      if (action === 'mute') { await this.wiim.setMute(body.muted!); return; }
      if (action === 'pause') { await this.wiim.pause(); return; }
      if (action === 'stop') {
        const owned = this.queue && this.indexFor(this.queue, (await this.wiim.transportState()).trackUri) >= 0;
        this.queue = undefined; clearTimeout(this.timer); this.warning = undefined;
        await this.wiim.stop();
        if (owned) await this.wiim.setNextUri('');
        return;
      }
      if (action === 'seek') { await this.wiim.seek(body.positionSeconds!); return; }
      const state = await this.wiim.transportState();
      const queue = this.observe(state);
      if (action === 'play') {
        if (queue) { queue.stoppedSince = undefined; await this.prepare(queue); }
        await this.wiim.play(); this.schedule(); return;
      }
      if (action === 'next' || action === 'previous') {
        if (!queue) throw new Error('Start an album in SHELF before skipping tracks.');
        const index = action === 'next' ? queue.index + 1 : Math.max(0, queue.index - 1);
        if (index >= queue.album.tracks.length) return;
        await this.load(queue, index);
      }
    });
  }
}

const id = z.string().regex(/^[a-f\d]{32}$/i);
export async function jellyfinPlaybackRoutes(app: FastifyInstance, { playback }: { playback: JellyfinPlayback }) {
  app.addHook('onClose', () => playback.close());
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.method === 'POST') {
      let otherOrigin = false;
      try { otherOrigin = !!request.headers.origin && new URL(request.headers.origin).host !== request.headers.host; } catch { otherOrigin = true; }
      if (request.headers['sec-fetch-site'] === 'cross-site' || otherOrigin) return reply.code(403).send({ error: 'Playback controls must be used from SHELF on this server.' });
    }
  });
  app.get('/playback', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); return playback.state(); });
  app.post('/playback/track/:id', async (request) => {
    const trackId = id.parse((request.params as { id: string }).id);
    const { albumId } = z.object({ albumId: id }).parse(request.body);
    await playback.start(albumId, trackId); return { ok: true };
  });
  app.post('/playback/:action', async (request) => {
    const action = z.enum(['play', 'pause', 'stop', 'seek', 'volume', 'mute', 'next', 'previous']).parse((request.params as { action: string }).action);
    const body = z.object({ positionSeconds: z.number().finite().min(0).max(86400).optional(), volume: z.number().finite().min(0).max(100).optional(), muted: z.boolean().optional() }).parse(request.body ?? {});
    if (action === 'seek') z.number().parse(body.positionSeconds);
    if (action === 'volume') z.number().parse(body.volume);
    if (action === 'mute') z.boolean().parse(body.muted);
    await playback.control(action, body); return { ok: true };
  });
}
