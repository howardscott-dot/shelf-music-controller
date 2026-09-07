import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CassetteArchive, cassetteRoutes, cassetteScans, cassetteTitle, matchingCassettes } from './cassettes.js';

const releaseId = 'a8dd9a25-ff0f-41ee-aba9-0c4202bff50f';
const release = { id: releaseId, title: 'A Real Album', score: 100, status: 'Official', media: [{ format: 'Cassette' }], 'artist-credit': [{ name: 'An Artist' }], country: 'GB', date: '1993' };
const front = { id: 123, types: ['Front'], approved: true, front: true };
const back = { id: 456, types: ['Back'], approved: true, back: true };
const spine = { id: 789, types: ['Spine'], approved: true };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let directory: string;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let searcher: ReturnType<typeof vi.fn<(url: URL) => Promise<Response>>>;
let archive: CassetteArchive;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-cassettes-test-'));
  fetcher = vi.fn<typeof fetch>(); searcher = vi.fn();
  archive = new CassetteArchive(directory, fetcher, searcher);
  searcher.mockResolvedValue(json({ releases: [release] }));
  fetcher.mockResolvedValue(json({ images: [front, back, spine] }));
});
afterEach(async () => { await archive.idle(); vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

describe('real cassette edition matching', () => {
  it('requires matching artist/title, official status, and cassette-only media', () => {
    expect(matchingCassettes([release, { ...release, media: [{ format: 'CD' }] }, { ...release, media: [{ format: 'Cassette' }, { format: 'CD' }] }, { ...release, status: 'Bootleg' }, { ...release, title: 'A Different Album' }, { ...release, 'artist-credit': [{ name: 'A Different Artist' }] }], 'An Artist', 'A Real Album')).toEqual([release]);
  });
  it('allows a remastered digital edition to find the original cassette, without stripping title parentheses', () => {
    expect(matchingCassettes([release], 'An Artist', 'A Real Album (2015 Remastered)')).toHaveLength(1);
    expect(cassetteTitle('(What’s the Story) Morning Glory?')).toBe('(What’s the Story) Morning Glory?');
    expect(cassetteTitle('Album - Remastered 2011')).toBe('Album');
  });
  it('prefers a standalone front over a whole J-card and never guesses a spine crop', () => {
    const jcard = { ...front, id: 12, back: true, types: ['Front', 'Back', 'Spine'] };
    expect(cassetteScans([jcard, front, back, spine])).toEqual({ front, back, spine });
    expect(cassetteScans([jcard])).toEqual({ front: jcard, back: undefined, spine: undefined });
    expect(cassetteScans([{ ...front, approved: false }]).front).toBeUndefined();
  });
  it('returns pending immediately, coalesces lookups, and persists a same-edition match', async () => {
    const results = await Promise.all([archive.lookup('An Artist', 'A Real Album'), archive.lookup('An Artist', 'A Real Album')]);
    expect(results.every((result) => result.status === 'pending')).toBe(true);
    await archive.idle();
    const result = await archive.lookup('An Artist', 'A Real Album');
    expect(result).toMatchObject({ status: 'found', edition: 'Cassette · GB · 1993', frontUrl: `/api/cassette-assets/${releaseId}/123/cover`, backUrl: `/api/cassette-assets/${releaseId}/456/cover`, spineUrl: `/api/cassette-assets/${releaseId}/789/spine` });
    expect(searcher).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(searcher.mock.calls[0]![0].searchParams.get('query')).toContain('format:Cassette');
    const restored = new CassetteArchive(directory, fetcher, searcher);
    expect(await restored.lookup('An Artist', 'A Real Album (Deluxe Edition)')).toEqual(result);
    expect(searcher).toHaveBeenCalledTimes(1);
  });
  it('tries another matching cassette when an edition has no scans', async () => {
    searcher.mockResolvedValueOnce(json({ releases: [{ ...release, id: '9053b9a5-f33e-4c02-a393-b2b3c9bcafee' }, release] }));
    fetcher.mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({ images: [front] }));
    await archive.lookup('An Artist', 'A Real Album'); await archive.idle();
    expect((await archive.lookup('An Artist', 'A Real Album')).frontUrl).toContain(releaseId);
  });
  it('negative-caches missing scans, with a separate short-lived state for outages', async () => {
    fetcher.mockResolvedValueOnce(json({}, 404));
    await archive.lookup('An Artist', 'A Real Album'); await archive.idle();
    expect((await archive.lookup('An Artist', 'A Real Album')).status).toBe('missing');
    expect((await archive.lookup('An Artist', 'A Real Album')).status).toBe('missing');
    expect(searcher).toHaveBeenCalledTimes(1);
    searcher.mockResolvedValueOnce(json({}, 503));
    await archive.lookup('An Artist', 'Another Album'); await archive.idle();
    expect(await archive.lookup('An Artist', 'Another Album')).toMatchObject({ status: 'unavailable', retryAfter: 300 });
  });
});

describe('cassette assets and API', () => {
  it('serves and caches high-resolution artwork without changing its aspect ratio', async () => {
    const input = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#adbabc' } }).jpeg().toBuffer();
    fetcher.mockImplementation(async () => new Response(new Uint8Array(input), { headers: { 'content-type': 'image/jpeg' } }));
    const [a, b] = await Promise.all([archive.image(releaseId, '123', 'cover'), archive.image(releaseId, '123', 'cover')]);
    expect(a.equals(b)).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await sharp(a).metadata()).toMatchObject({ width: 800, height: 1200 });
    expect((await readFile(join(directory, `${releaseId}_123_cover.jpg`))).equals(a)).toBe(true);
    await archive.image(releaseId, '123', 'cover'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rotates a genuine horizontal spine but rejects a square image labelled spine', async () => {
    const horizontal = await sharp({ create: { width: 1000, height: 100, channels: 3, background: '#abcdef' } }).jpeg().toBuffer();
    const square = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#abcdef' } }).jpeg().toBuffer();
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(horizontal), { headers: { 'content-type': 'image/jpeg' } }));
    expect(await sharp(await archive.image(releaseId, '789', 'spine')).metadata()).toMatchObject({ width: 100, height: 1000 });
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(square), { headers: { 'content-type': 'image/jpeg' } }));
    await expect(archive.image(releaseId, '999', 'spine')).rejects.toThrow('Not a standalone');
  });
  it('rejects oversized and non-image responses without persisting them', async () => {
    fetcher.mockResolvedValueOnce(new Response('no', { headers: { 'content-type': 'text/html' } }));
    await expect(archive.image(releaseId, '1', 'cover')).rejects.toThrow('Scan unavailable');
    fetcher.mockResolvedValueOnce(new Response('huge', { headers: { 'content-type': 'image/jpeg', 'content-length': String(21 * 1024 * 1024) } }));
    await expect(archive.image(releaseId, '2', 'cover')).rejects.toThrow('Scan too large');
  });
  it('does not turn user-controlled IDs into URLs or file paths', async () => {
    await expect(archive.image('../../secret', '123', 'cover')).rejects.toThrow();
    await expect(archive.image(releaseId, 'https://localhost', 'cover')).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('exposes the same independent scan endpoint for both libraries, with no Spotify credentials', async () => {
    const app = Fastify(); await app.register(cassetteRoutes, { prefix: '/api', archive });
    const result = await app.inject('/api/cassettes?artist=An%20Artist&title=A%20Real%20Album');
    expect(result.json().status).toBe('pending'); expect(result.headers['cache-control']).toBe('no-store');
    await archive.idle();
    const found = await app.inject('/api/cassettes?artist=An%20Artist&title=A%20Real%20Album');
    expect(found.json().status).toBe('found');
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('spotify'))).toBe(false);
    await app.close();
  });
});
