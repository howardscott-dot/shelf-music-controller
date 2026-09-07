import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { musicBrainzFetch } from './musicbrainz.js';

export interface CassetteArtwork {
  status: 'pending' | 'found' | 'missing' | 'unavailable';
  retryAfter?: number;
  releaseUrl?: string;
  edition?: string;
  frontUrl?: string;
  backUrl?: string;
  spineUrl?: string;
}
interface Release {
  id: string; title: string; score?: number; status?: string; country?: string; date?: string;
  media?: { format?: string }[];
  'artist-credit'?: { name?: string; artist?: { name?: string }; joinphrase?: string }[];
}
interface Scan { id: string | number; types?: string[]; approved?: boolean; front?: boolean; back?: boolean }
interface Cached { expires: number; result: CassetteArtwork }
const uuid = z.string().uuid();
const assetId = z.string().regex(/^\d{1,24}$/);
const day = 86400_000;

export function cassetteTitle(title: string) {
  // Remove edition suffixes only. Parentheses that are part of a title survive.
  return title.replace(/\s*[([][^)\]]*\b(?:remaster(?:ed)?|deluxe|anniversary|expanded|bonus tracks?)\b[^)\]]*[)\]]/gi, '').replace(/\s+-\s+(?:(?:19|20)\d{2}\s+)?remaster(?:ed)?(?:\s+(?:19|20)\d{2})?$/i, '').trim();
}
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');
const quote = (value: string) => `"${value.replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1')}"`;
export function matchingCassettes(releases: Release[], artist: string, title: string): Release[] {
  return releases.filter((release) => {
    const credit = release['artist-credit']?.map((part) => `${part.name ?? part.artist?.name ?? ''}${part.joinphrase ?? ''}`).join('') ?? '';
    const formats = release.media?.map((medium) => medium.format?.toLowerCase()) ?? [];
    return uuid.safeParse(release.id).success && release.status?.toLowerCase() === 'official'
      && formats.length > 0 && formats.every((format) => format === 'cassette')
      && normalize(cassetteTitle(release.title)) === normalize(cassetteTitle(title))
      && normalize(credit) === normalize(artist) && (release.score ?? 100) >= 90;
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
const hasType = (scan: Scan, type: string) => scan.types?.some((value) => value.toLowerCase() === type) || (type === 'front' && scan.front) || (type === 'back' && scan.back);
export function cassetteScans(images: Scan[]) {
  const scans = images.filter((scan) => scan.approved === true && assetId.safeParse(String(scan.id)).success);
  const face = (type: string) => scans.filter((scan) => hasType(scan, type)).sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0))[0];
  // Never guess where a spine is within a combined J-card. Its complete image
  // is still available as the front/back; a spine needs a dedicated scan.
  const spine = scans.find((scan) => hasType(scan, 'spine') && !scan.types?.some((type) => ['front', 'back', 'booklet', 'medium', 'liner', 'tray'].includes(type.toLowerCase())));
  const front = face('front');
  const back = scans.filter((scan) => String(scan.id) !== String(front?.id) && hasType(scan, 'back')).sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0))[0];
  return { front, back, spine };
}

async function boundedImage(response: Response): Promise<Buffer> {
  if (!response.ok || !/^image\/(jpeg|png|webp)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Scan unavailable');
  const max = 20 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max) throw new Error('Scan too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty scan');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > max) throw new Error('Scan too large'); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export class CassetteArchive {
  private readonly memory = new Map<string, Cached>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly assets = new Map<string, Promise<Buffer>>();
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(
    private readonly directory = fileURLToPath(new URL('../../../.cache/cassettes-v1/', import.meta.url)),
    private readonly fetcher: typeof fetch = fetch,
    private readonly searcher: (url: URL) => Promise<Response> = musicBrainzFetch
  ) {}

  private async remember(key: string, result: CassetteArtwork) {
    const cached = { result, expires: Date.now() + (result.status === 'unavailable' ? 300_000 : result.status === 'found' ? 30 * day : 7 * day) };
    this.memory.set(key, cached);
    if (this.memory.size > 1000) this.memory.delete(this.memory.keys().next().value!);
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, `${key}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(cached)); await rename(`${file}.tmp`, file);
  }
  async lookup(artist: string, title: string): Promise<CassetteArtwork> {
    const key = createHash('sha256').update(JSON.stringify([normalize(artist), normalize(cassetteTitle(title))])).digest('hex');
    let cached = this.memory.get(key);
    if (!cached) { try { cached = JSON.parse(await readFile(join(this.directory, `${key}.json`), 'utf8')) as Cached; } catch { /* First lookup. */ } }
    if (cached?.expires && cached.expires > Date.now() && cached.result?.status) { this.memory.set(key, cached); return cached.result; }
    if (!this.pending.has(key)) {
      if (this.pending.size >= 32) return { status: 'pending', retryAfter: 10 };
      let finish!: () => void;
      this.pending.set(key, new Promise<void>((resolve) => { finish = resolve; }));
      this.queue.push(() => {
        this.active++;
        void this.resolve(artist, title).catch((): CassetteArtwork => ({ status: 'unavailable', retryAfter: 300 }))
          .then((result) => this.remember(key, result)).catch(() => { this.memory.set(key, { result: { status: 'unavailable', retryAfter: 300 }, expires: Date.now() + 300_000 }); })
          .finally(() => { this.active--; this.pending.delete(key); finish(); this.pump(); });
      });
      this.pump();
    }
    return { status: 'pending', retryAfter: 3 };
  }
  private pump() { while (this.active < 2 && this.queue.length) this.queue.shift()!(); }
  async idle() { while (this.pending.size) await Promise.all(this.pending.values()); }

  private async resolve(artist: string, title: string): Promise<CassetteArtwork> {
    if (!normalize(title) || !normalize(artist) || /^(unknown artist|various artists?)$/i.test(artist)) return { status: 'missing' };
    const query = new URL('https://musicbrainz.org/ws/2/release/');
    query.search = new URLSearchParams({ query: `release:${quote(cassetteTitle(title))} AND artist:${quote(artist)} AND format:Cassette AND status:official`, fmt: 'json', limit: '25' }).toString();
    const response = await this.searcher(query);
    if (!response.ok) throw new Error('Archive search temporarily unavailable');
    const data = await response.json() as { releases?: Release[] };
    const candidates = matchingCassettes(data.releases ?? [], artist, title).slice(0, 6);
    let transientFailure = false;
    for (const release of candidates) {
      try {
        const response = await this.fetcher(`https://coverartarchive.org/release/${release.id}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (response.status === 404) continue;
        if (!response.ok) { transientFailure = true; continue; }
        const data = await response.json() as { images?: Scan[] };
        const { front, back, spine } = cassetteScans(data.images ?? []);
        if (!front) continue;
        const asset = (scan: Scan | undefined, view = 'cover') => scan ? `/api/cassette-assets/${release.id}/${scan.id}/${view}` : undefined;
        return { status: 'found', releaseUrl: `https://musicbrainz.org/release/${release.id}/cover-art`, edition: ['Cassette', release.country, release.date].filter(Boolean).join(' · '), frontUrl: asset(front), backUrl: asset(back), spineUrl: asset(spine, 'spine') };
      } catch { transientFailure = true; }
    }
    return transientFailure ? { status: 'unavailable', retryAfter: 300 } : { status: 'missing' };
  }

  async image(release: string, id: string, view: 'cover' | 'spine'): Promise<Buffer> {
    uuid.parse(release); assetId.parse(id);
    const key = `${release}_${id}_${view}`;
    const file = join(this.directory, `${key}.jpg`);
    try { return await readFile(file); } catch { /* Fetch once across LAN browsers. */ }
    if (!this.assets.has(key)) {
      if (this.assets.size >= 6) throw new Error('Artwork busy');
      const task = (async () => {
        const base = `https://coverartarchive.org/release/${release}/${id}`;
        const options = { signal: AbortSignal.timeout(20_000) };
        let response = await this.fetcher(`${base}-1200`, options);
        if (response.status === 404) response = await this.fetcher(base, { signal: AbortSignal.timeout(20_000) });
        const input = await boundedImage(response);
        let pipeline = sharp(input, { limitInputPixels: 40_000_000 }).autoOrient();
        if (view === 'spine') {
          const { width = 0, height = 0 } = await sharp(input).metadata();
          const ratio = width / height;
          if (!((ratio >= 0.04 && ratio <= 0.3) || (ratio >= 3.33 && ratio <= 25))) throw new Error('Not a standalone spine scan');
          if (ratio > 1) pipeline = pipeline.rotate(90);
        }
        const result = await pipeline.resize({ width: view === 'spine' ? 400 : 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#080808' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
        await mkdir(this.directory, { recursive: true });
        await writeFile(`${file}.tmp`, result); await rename(`${file}.tmp`, file);
        return result;
      })().finally(() => this.assets.delete(key));
      this.assets.set(key, task);
    }
    return this.assets.get(key)!;
  }
}

export async function cassetteRoutes(app: FastifyInstance, { archive }: { archive: CassetteArchive }) {
  app.get('/cassettes', async (request, reply) => {
    const { artist, title } = z.object({ artist: z.string().trim().min(1).max(300), title: z.string().trim().min(1).max(300) }).parse(request.query);
    reply.header('Cache-Control', 'no-store');
    return archive.lookup(artist, title);
  });
  app.get('/cassette-assets/:release/:id/:view', async (request, reply) => {
    const { release, id, view } = z.object({ release: uuid, id: assetId, view: z.enum(['cover', 'spine']) }).parse(request.params);
    try {
      const image = await archive.image(release, id, view);
      return reply.type('image/jpeg').header('Cache-Control', 'public, max-age=2592000, immutable').header('X-Shelf-Artwork-Source', 'cover-art-archive-cassette').send(image);
    } catch { return reply.header('Cache-Control', 'no-store').code(503).send({ error: 'Cassette scan temporarily unavailable' }); }
  });
}
