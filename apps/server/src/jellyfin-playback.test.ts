import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { JellyfinPlayback, jellyfinPlaybackRoutes } from './jellyfin-playback.js';
import type { AlbumDetail, Track } from './types.js';
import type { WiimTransportState } from './wiim.js';

const album: AlbumDetail = {
  id: 'a'.repeat(32), title: 'An album', artist: 'An artist', genres: [], artworkUrl: '/api/artwork/album?width=900', spineUrl: '', backArtworkUrl: '', durationSeconds: 540,
  tracks: [1, 2, 3].map((index): Track => ({ id: String(index).repeat(32), title: `Track ${index}`, artist: 'An artist', album: 'An album', index, disc: 1, durationSeconds: 180 }))
};
const url = (id: string) => `http://jellyfin.local/Audio/${id}/stream?api_key=private-key`;
let playback: JellyfinPlayback;
let current: WiimTransportState;
let next: string;
// A deliberately mutable simulated renderer; individual tests replace methods
// and transport state to model firmware behaviour.
let wiim: any;
let library: any;
function finishTrack() {
  current = { ...current, trackUri: next || current.trackUri, transport: next ? 'PLAYING' : 'STOPPED', positionSeconds: 0 };
  next = '';
}
beforeEach(() => {
  vi.useFakeTimers();
  current = { transport: 'STOPPED', positionSeconds: 0, durationSeconds: 180 };
  next = '';
  wiim = {
    setUri: vi.fn(async (uri: string) => { current = { ...current, trackUri: uri, transport: 'STOPPED', positionSeconds: 0 }; }),
    setNextUri: vi.fn(async (uri: string) => { next = uri; }),
    play: vi.fn(async () => { current.transport = 'PLAYING'; }), pause: vi.fn(async () => { current.transport = 'PAUSED_PLAYBACK'; }), stop: vi.fn(async () => { current.transport = 'STOPPED'; }),
    seek: vi.fn(async (seconds: number) => { current.positionSeconds = seconds; }), setVolume: vi.fn(async () => {}), setMute: vi.fn(async () => {}),
    transportState: vi.fn(async () => ({ ...current })), state: vi.fn(async () => ({ ...current, volume: 40, muted: false }))
    ,supportsNextUri: vi.fn(() => true)
  };
  library = { album: vi.fn(async () => album), streamUrl: url };
  playback = new JellyfinPlayback(wiim, library, () => 'http://jellyfin.local/cover?api_key=private-key');
});
afterEach(async () => { await playback.close(); vi.useRealTimers(); });

describe('continuous Jellyfin album playback', () => {
  it('preloads track two BEFORE Play and continues beyond it without a browser polling', async () => {
    await playback.start(album.id, album.tracks[0]!.id);
    expect(next).toBe(url(album.tracks[1]!.id));
    expect(wiim.setNextUri.mock.invocationCallOrder[0]).toBeLessThan(wiim.play.mock.invocationCallOrder[0]!);
    finishTrack(); await vi.advanceTimersByTimeAsync(1000);
    expect(next).toBe(url(album.tracks[2]!.id));
    finishTrack(); await vi.advanceTimersByTimeAsync(1000);
    expect(next).toBe('');
    finishTrack(); await vi.advanceTimersByTimeAsync(20_000);
    expect(current.transport).toBe('STOPPED');
    expect(wiim.setUri).toHaveBeenCalledTimes(1); expect(wiim.play).toHaveBeenCalledTimes(1);
    expect(wiim.state).not.toHaveBeenCalled();
  });
  it('starts at the selected track and queues only its successors', async () => {
    await playback.start(album.id, album.tracks[1]!.id);
    expect(current.trackUri).toBe(url(album.tracks[1]!.id)); expect(next).toBe(url(album.tracks[2]!.id));
    expect(await playback.state()).toMatchObject({ trackId: album.tracks[1]!.id, albumId: album.id, queueIndex: 1, queueLength: 3 });
  });
  it('clears a stale next URI for a single-track album or final-track selection', async () => {
    next = 'http://old-album/track';
    await playback.start(album.id, album.tracks[2]!.id);
    expect(next).toBe('');
    finishTrack(); await vi.advanceTimersByTimeAsync(10_000);
    expect(wiim.play).toHaveBeenCalledTimes(1);
  });
  it('never restarts after an explicit stop and clears the native next buffer', async () => {
    await playback.start(album.id, album.tracks[0]!.id);
    await playback.control('stop'); await vi.advanceTimersByTimeAsync(60_000);
    expect(current.transport).toBe('STOPPED'); expect(next).toBe('');
    expect(wiim.play).toHaveBeenCalledTimes(1); expect((await playback.state()).albumId).toBeUndefined();
  });
  it('does not advance on pause, seek, or an external stop—even at track end', async () => {
    await playback.start(album.id, album.tracks[0]!.id);
    await playback.control('seek', { positionSeconds: 179 });
    await playback.control('pause'); await vi.advanceTimersByTimeAsync(10_000);
    expect(current.transport).toBe('PAUSED_PLAYBACK'); expect(wiim.play).toHaveBeenCalledTimes(1);
    current.transport = 'STOPPED'; await vi.advanceTimersByTimeAsync(30_000);
    expect(wiim.play).toHaveBeenCalledTimes(1); expect(wiim.setUri).toHaveBeenCalledTimes(1);
    await playback.control('play'); expect(current.transport).toBe('PLAYING');
    finishTrack(); await vi.advanceTimersByTimeAsync(1000); expect(next).toBe(url(album.tracks[2]!.id));
  });
  it('skips relative to the renderer’s actual track, not a stale browser selection', async () => {
    await playback.start(album.id, album.tracks[0]!.id);
    finishTrack(); // Device advanced, but the periodic observer has not run yet.
    await playback.control('next'); expect(current.trackUri).toBe(url(album.tracks[2]!.id));
    await playback.control('previous'); expect(current.trackUri).toBe(url(album.tracks[1]!.id));
  });
  it('does not loop to the first track when Next is pressed at album end', async () => {
    await playback.start(album.id, album.tracks[2]!.id);
    await playback.control('next'); expect(wiim.setUri).toHaveBeenCalledTimes(1);
    expect((await playback.state()).disallows?.skipping_next).toBe(true);
  });
  it('replaces the entire queue when a different album is played', async () => {
    await playback.start(album.id, album.tracks[0]!.id);
    const other = { ...album, id: 'b'.repeat(32), tracks: [{ ...album.tracks[0]!, id: '9'.repeat(32) }] };
    library.album.mockResolvedValueOnce(other);
    await playback.start(other.id, other.tracks[0]!.id);
    expect(next).toBe(''); expect((await playback.state()).albumId).toBe(other.id);
  });
  it('relinquishes its queue if Spotify or another controller takes over, without touching that source', async () => {
    await playback.start(album.id, album.tracks[0]!.id); await playback.tick();
    const calls = wiim.setNextUri.mock.calls.length;
    current = { ...current, trackUri: 'https://another-player.example/music', transport: 'PLAYING' };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(wiim.setNextUri).toHaveBeenCalledTimes(calls); expect(wiim.play).toHaveBeenCalledTimes(1); expect(wiim.stop).not.toHaveBeenCalled();
    expect((await playback.state()).albumId).toBeUndefined();
  });
  it('ignores missing URIs during transitions, and recovers when the next URI appears', async () => {
    await playback.start(album.id, album.tracks[0]!.id); await playback.tick();
    current = { ...current, transport: 'TRANSITIONING', trackUri: '' };
    await vi.advanceTimersByTimeAsync(1000); expect(wiim.setNextUri).toHaveBeenCalledTimes(1);
    finishTrack(); await vi.advanceTimersByTimeAsync(1000); expect(next).toBe(url(album.tracks[2]!.id));
  });
  it('retries transient queue updates without replaying a track or skipping twice', async () => {
    await playback.start(album.id, album.tracks[0]!.id); finishTrack();
    wiim.setNextUri.mockRejectedValueOnce(new Error('temporary network error'));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await playback.state()).queueWarning).toContain('could not refresh');
    await vi.advanceTimersByTimeAsync(3000);
    expect(next).toBe(url(album.tracks[2]!.id)); expect((await playback.state()).queueWarning).toBeUndefined();
    expect(wiim.play).toHaveBeenCalledTimes(1);
  });
  it('surfaces a failed preload instead of silently starting another one-track session', async () => {
    wiim.setNextUri.mockRejectedValueOnce(new Error('unsupported'));
    await expect(playback.start(album.id, album.tracks[0]!.id)).rejects.toThrow('continuous album playback');
    expect(wiim.play).not.toHaveBeenCalled(); expect(wiim.stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); expect(wiim.transportState).not.toHaveBeenCalled();
  });
  it('advances server-side when a compatible renderer lacks the optional next-URI action', async () => {
    wiim.supportsNextUri.mockReturnValue(false); wiim.setNextUri.mockImplementation(async () => {});
    await playback.start(album.id, album.tracks[0]!.id);
    current.positionSeconds = 179; await playback.tick(); current.transport = 'STOPPED'; current.positionSeconds = 0; await playback.tick();
    expect(current.trackUri).toBe(url(album.tracks[1]!.id)); expect(wiim.play).toHaveBeenCalledTimes(2);
  });
  it('validates membership before changing playback', async () => {
    await expect(playback.start(album.id, '4'.repeat(32))).rejects.toThrow('belong');
    expect(wiim.setUri).not.toHaveBeenCalled();
  });
  it('serializes concurrent control requests across LAN clients', async () => {
    await playback.start(album.id, album.tracks[0]!.id);
    await Promise.all([playback.control('next'), playback.control('next')]);
    expect(current.trackUri).toBe(url(album.tracks[2]!.id)); expect(wiim.play).toHaveBeenCalledTimes(3);
  });
  it('never exposes private stream/artwork URLs in the playback response', async () => {
    await playback.start(album.id, album.tracks[0]!.id);
    current.artworkUrl = 'http://jellyfin.local/art?api_key=private-key';
    const state = await playback.state();
    expect(JSON.stringify(state)).not.toContain('private-key'); expect(JSON.stringify(state)).not.toContain('trackUri');
    expect(state.artworkUrl).toBe(album.artworkUrl);
  });
  it('stops its observer on server shutdown without sending stop to the speaker', async () => {
    await playback.start(album.id, album.tracks[0]!.id); await playback.close(); await vi.advanceTimersByTimeAsync(10_000);
    expect(wiim.transportState).not.toHaveBeenCalled(); expect(wiim.stop).not.toHaveBeenCalled();
  });
});

describe('queue-aware HTTP routes', () => {
  it('rejects invalid values and cross-site controls before touching the speaker', async () => {
    vi.useRealTimers();
    const app = Fastify(); app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ error: error instanceof Error ? error.message : 'Error' }));
    await app.register(jellyfinPlaybackRoutes, { prefix: '/api', playback });
    try {
      expect((await app.inject({ method: 'POST', url: '/api/playback/seek', payload: {} })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/playback/volume', payload: { volume: 101 } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/playback/play', headers: { origin: 'https://other.example' }, payload: {} })).statusCode).toBe(403);
      expect(wiim.seek).not.toHaveBeenCalled(); expect(wiim.play).not.toHaveBeenCalled();
      expect((await app.inject('/api/playback')).headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });
});
