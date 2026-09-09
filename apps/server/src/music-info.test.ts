import { describe, expect, it, vi } from 'vitest';
import { MusicInfoService } from './music-info.js';
import type { AlbumDetail, Track } from './types.js';

const track: Track = { id: 'track', title: 'Clouds', artist: 'Night Artist', album: 'Blue Atmosphere', index: 1, disc: 1, durationSeconds: 180 };
const album: AlbumDetail = { id: 'album', title: 'Blue Atmosphere', artist: 'Night Artist', genres: [], artworkUrl: '', backArtworkUrl: '', spineUrl: '', durationSeconds: 180, tracks: [track] };

describe('sourced music information', () => {
  it('uses local library lyrics without making a public lyrics request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    const service = new MusicInfoService(fetcher as never);
    const result = await service.trackInfo(track, { plain: 'Local words', sourceName: 'Jellyfin library' });
    expect(result.lyrics).toMatchObject({ plain: 'Local words', sourceName: 'Jellyfin library' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('wikipedia.org');
  });

  it('retrieves public lyrics on demand and strips timestamps when needed', async () => {
    const fetcher = vi.fn(async (url: URL) => String(url).includes('wikipedia')
      ? { ok: false }
      : { ok: true, json: async () => ({ syncedLyrics: '[00:01.00]First line\n[00:04.00]Second line' }) });
    const result = await new MusicInfoService(fetcher as never).trackInfo(track);
    expect(result.lyrics?.plain).toBe('First line\nSecond line');
    expect(result.lyrics?.sourceName).toBe('LRCLIB');
  });

  it('rejects unrelated encyclopedia results instead of inventing a story', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { pages: { 1: { title: 'Clouds', extract: 'A weather phenomenon.', fullurl: 'https://example.test' } } } }) });
    expect(await new MusicInfoService(fetcher as never).albumStory(album)).toBeUndefined();
  });
});
