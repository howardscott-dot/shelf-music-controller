import { expect, it, vi } from 'vitest';
import { PlexClient } from './plex.js';

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
it('reads albums and playable track parts from the documented Plex JSON API without exposing its token in artwork URLs', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/library/sections') && !url.includes('/albums')) return json({ MediaContainer: { Directory: [{ key: '7', title: 'Music', type: 'artist' }] } });
    if (url.includes('/albums')) return json({ MediaContainer: { totalSize: 1, Metadata: [{ ratingKey: '10', title: 'Album', parentTitle: 'Artist', thumb: '/library/metadata/10/thumb', year: 1997 }] } });
    if (url.includes('/children')) return json({ MediaContainer: { Metadata: [{ ratingKey: '11', title: 'Track', grandparentTitle: 'Artist', index: 1, parentIndex: 1, duration: 123000, Media: [{ Part: [{ key: '/library/parts/99/file.flac' }] }] }] } });
    return json({ MediaContainer: { Metadata: [{ ratingKey: '10', title: 'Album', parentTitle: 'Artist', thumb: '/library/metadata/10/thumb', year: 1997 }] } });
  });
  const plex = new PlexClient('http://plex.local:32400', 'private-token', undefined, fetcher);
  expect((await plex.albums()).items[0]).toMatchObject({ source: 'plex', id: '10', title: 'Album', artist: 'Artist' });
  const album = await plex.album('10'); expect(album.tracks[0]).toMatchObject({ id: '11', title: 'Track', durationSeconds: 123 });
  expect(album.artworkUrl).not.toContain('private-token');
  expect(plex.streamUrl('11')).toContain('/library/parts/99/file.flac'); expect(plex.streamUrl('11')).toContain('X-Plex-Token=private-token');
  const headers = (fetcher.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
  expect(headers.Accept).toBe('application/json'); expect(headers['X-Plex-Token']).toBe('private-token');
});
