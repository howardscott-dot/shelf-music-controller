import type { AlbumDetail, AlbumSummary, Track } from './types.js';
import { cleanAlbumMetadata } from './metadata.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { musicBrainzFetch } from './musicbrainz.js';

interface JellyfinItem {
  Id: string;
  Name: string;
  Album?: string;
  AlbumArtist?: string;
  Artists?: string[];
  ProductionYear?: number;
  Genres?: string[];
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProviderIds?: Record<string, string>;
}

interface QueryResult { Items?: JellyfinItem[]; TotalRecordCount?: number }
interface JellyfinUser { Id: string; Name: string }
interface ArchiveImage { image: string; thumbnails?: Record<string, string>; types?: string[]; approved?: boolean; front?: boolean; back?: boolean }
interface ArchiveMetadata { images?: ArchiveImage[] }
interface ArtworkMatch { release?: string; releases?: string[]; group?: string }

export class JellyfinClient {
  private resolvedUserId?: string;
  private readonly artworkMatches = new Map<string, Promise<ArtworkMatch | undefined>>();
  private readonly archiveMatches = new Map<string, Promise<ArchiveMetadata | undefined>>();
  private readonly pendingSpines = new Map<string, Promise<void>>();
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly userId: string
  ) {}

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    const response = await fetch(url, { headers: { 'X-Emby-Token': this.apiKey } });
    if (!response.ok) throw new Error(`Jellyfin ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  private artworkPath(id: string, width: number): string {
    return `/api/artwork/${encodeURIComponent(id)}?width=${width}`;
  }

  private async user(): Promise<string> {
    if (this.resolvedUserId) return this.resolvedUserId;
    if (/^[a-f\d]{32}$/i.test(this.userId)) return (this.resolvedUserId = this.userId);
    const users = await this.get<JellyfinUser[]>('Users');
    const match = users.find((user) => user.Name.toLocaleLowerCase() === this.userId.toLocaleLowerCase());
    if (!match) throw new Error(`Jellyfin user "${this.userId}" was not found`);
    return (this.resolvedUserId = match.Id);
  }

  async albums(start = 0, limit = 100): Promise<{ items: AlbumSummary[]; total: number }> {
    const userId = await this.user();
    const data = await this.get<QueryResult>(`Users/${userId}/Items`, {
      IncludeItemTypes: 'MusicAlbum', Recursive: true, SortBy: 'AlbumArtist,SortName', SortOrder: 'Ascending',
      Fields: 'Genres,PrimaryImageAspectRatio', StartIndex: start, Limit: limit, EnableImages: true
    });
    return {
      items: (data.Items ?? []).map((item) => {
        const display = cleanAlbumMetadata(item.AlbumArtist ?? item.Artists?.[0] ?? 'Unknown artist', item.Name);
        return {
          id: item.Id, title: display.title, artist: display.artist,
          year: item.ProductionYear, genres: item.Genres ?? [], artworkUrl: this.artworkPath(item.Id, 720),
          backArtworkUrl: `/api/artwork/${encodeURIComponent(item.Id)}?side=back&width=1200`,
          spineUrl: `/api/spines/${encodeURIComponent(item.Id)}?v=4`
        };
      }),
      total: data.TotalRecordCount ?? 0
    };
  }

  async album(id: string): Promise<AlbumDetail> {
    const userId = await this.user();
    const [item, tracks] = await Promise.all([
      this.get<JellyfinItem>(`Users/${userId}/Items/${id}`),
      this.get<QueryResult>(`Users/${userId}/Items`, {
        AlbumIds: id, IncludeItemTypes: 'Audio', Recursive: true, SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        SortOrder: 'Ascending', Fields: 'Genres,RunTimeTicks'
      })
    ]);
    const mapped: Track[] = (tracks.Items ?? []).map((track) => ({
      id: track.Id, title: track.Name, artist: track.AlbumArtist ?? track.Artists?.[0] ?? 'Unknown artist',
      album: track.Album ?? item.Name, index: track.IndexNumber ?? 0, disc: track.ParentIndexNumber && track.ParentIndexNumber > 0 ? track.ParentIndexNumber : 1,
      durationSeconds: Math.round((track.RunTimeTicks ?? 0) / 10_000_000)
    }));
    mapped.sort((left, right) => left.disc - right.disc || left.index - right.index || left.title.localeCompare(right.title));
    const display = cleanAlbumMetadata(item.AlbumArtist ?? item.Artists?.[0] ?? 'Unknown artist', item.Name);
    return {
      id: item.Id, title: display.title, artist: display.artist,
      year: item.ProductionYear, genres: item.Genres ?? [], artworkUrl: this.artworkPath(item.Id, 900),
      backArtworkUrl: `/api/artwork/${encodeURIComponent(item.Id)}?side=back&width=1200`,
      spineUrl: `/api/spines/${encodeURIComponent(item.Id)}?v=4`, tracks: mapped,
      durationSeconds: mapped.reduce((sum, track) => sum + track.durationSeconds, 0)
    };
  }

  imageUrl(id: string, width: number): URL {
    const url = new URL(`Items/${encodeURIComponent(id)}/Images/Primary`, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    url.searchParams.set('maxWidth', String(width));
    url.searchParams.set('quality', '90');
    return url;
  }

  private async musicBrainzMatch(item: JellyfinItem): Promise<ArtworkMatch | undefined> {
    const supplied = { release: item.ProviderIds?.MusicBrainzAlbum, group: item.ProviderIds?.MusicBrainzReleaseGroup };
    const artist = item.AlbumArtist ?? item.Artists?.[0];
    if (!artist || artist === 'Unknown artist') return supplied.release || supplied.group ? supplied : undefined;
    const display = cleanAlbumMetadata(artist, item.Name);
    const query = new URL('https://musicbrainz.org/ws/2/release/');
    query.searchParams.set('query', `release:"${display.title.replaceAll('"', '')}" AND artist:"${display.artist.replaceAll('"', '')}"`);
    query.searchParams.set('fmt', 'json');
    query.searchParams.set('limit', '8');
    const response = await musicBrainzFetch(query);
    if (!response.ok) return supplied.release || supplied.group ? supplied : undefined;
    const result = await response.json() as { releases?: Array<{ id: string; score: number; status?: string; media?: Array<{ format?: string }>; 'release-group'?: { id: string } }> };
    const candidates = (result.releases ?? []).filter((release) => release.score >= 95).sort((left, right) => {
      const cd = (release: typeof left) => release.media?.some((medium) => medium.format?.toLocaleLowerCase().includes('cd')) ? 1 : 0;
      const official = (release: typeof left) => release.status === 'Official' ? 1 : 0;
      return cd(right) - cd(left) || official(right) - official(left) || right.score - left.score;
    });
    const best = candidates[0];
    if (!best) return supplied.release || supplied.group ? supplied : undefined;
    // Text matching is authoritative here: Jellyfin libraries can contain a
    // stale MusicBrainz ID copied from a different album.
    return { release: best.id, releases: candidates.map((release) => release.id), group: best['release-group']?.id };
  }

  private artworkMatch(item: JellyfinItem): Promise<ArtworkMatch | undefined> {
    const existing = this.artworkMatches.get(item.Id);
    if (existing) return existing;
    const pending = this.musicBrainzMatch(item).catch(() => undefined);
    this.artworkMatches.set(item.Id, pending);
    return pending;
  }

  private async archiveImage(item: JellyfinItem, width: number): Promise<Response | undefined> {
    const match = await this.artworkMatch(item);
    const size = width <= 300 ? 250 : width <= 700 ? 500 : 1200;
    for (const [kind, id] of [['release', match?.release], ['release-group', match?.group]] as const) {
      if (!id) continue;
      const response = await fetch(`https://coverartarchive.org/${kind}/${encodeURIComponent(id)}/front-${size}`, {
        headers: { 'User-Agent': 'SHELF/0.1 (self-hosted music controller)' }, signal: AbortSignal.timeout(12_000)
      });
      if (response.ok) return response;
    }
    return undefined;
  }

  private async findArchiveMetadata(item: JellyfinItem, type: 'Back' | 'Spine'): Promise<ArchiveMetadata | undefined> {
    const match = await this.artworkMatch(item);
    const releases = [...new Set([...(match?.releases ?? []), match?.release].filter((id): id is string => Boolean(id)))].slice(0, 8);
    const targets: Array<readonly ['release' | 'release-group', string]> = releases.map((id) => ['release', id] as const);
    if (match?.group) targets.push(['release-group', match.group]);
    const results = await Promise.all(targets.map(async ([kind, id]) => {
      const response = await fetch(`https://coverartarchive.org/${kind}/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'SHELF/0.1 (self-hosted music controller)' },
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) return undefined;
      const metadata = await response.json() as ArchiveMetadata;
      return this.selectPackagingImage(metadata, type) ? metadata : undefined;
    }));
    return results.find((metadata) => metadata !== undefined);
  }

  private archiveMetadata(item: JellyfinItem, type: 'Back' | 'Spine'): Promise<ArchiveMetadata | undefined> {
    const key = `${item.Id}:${type}`;
    const existing = this.archiveMatches.get(key);
    if (existing) return existing;
    const pending = this.findArchiveMetadata(item, type).catch(() => undefined);
    this.archiveMatches.set(key, pending);
    return pending;
  }

  private selectPackagingImage(metadata: ArchiveMetadata | undefined, type: 'Back' | 'Spine'): ArchiveImage | undefined {
    const images = metadata?.images ?? [];
    const typed = images.filter((image) => image.types?.some((value) => value.toLocaleLowerCase() === type.toLocaleLowerCase()) || (type === 'Back' && image.back));
    return typed.find((image) => image.approved !== false) ?? typed[0];
  }

  private async fetchArchiveAsset(image: ArchiveImage, width: number): Promise<Response | undefined> {
    const size = width <= 300 ? '250' : width <= 700 ? '500' : '1200';
    const url = image.thumbnails?.[size] ?? image.image;
    const response = await fetch(url, { headers: { 'User-Agent': 'SHELF/0.1 (self-hosted music controller)' }, signal: AbortSignal.timeout(15_000) });
    return response.ok ? response : undefined;
  }

  async packagingImage(id: string, type: 'Back', width: number): Promise<Response | undefined> {
    const userId = await this.user();
    const item = await this.get<JellyfinItem>(`Users/${userId}/Items/${id}`);
    const image = this.selectPackagingImage(await this.archiveMetadata(item, type), type);
    return image ? this.fetchArchiveAsset(image, width) : undefined;
  }

  private async generateSpine(id: string, cacheFile: URL, cacheDirectory: URL): Promise<void> {
    try {
      const userId = await this.user();
      const item = await this.get<JellyfinItem>(`Users/${userId}/Items/${id}`);
      const source = this.selectPackagingImage(await this.archiveMetadata(item, 'Spine'), 'Spine');
      if (!source) return;
      const response = await this.fetchArchiveAsset(source, 1200);
      if (!response) return;
      const input = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(input).metadata();
      if (!metadata.width || !metadata.height) return;

      const isDedicatedSpine = metadata.width / metadata.height < 0.28;
      const pipeline = sharp(input);
      if (!isDedicatedSpine) {
        const cropWidth = Math.max(24, Math.round(metadata.width * (metadata.width > metadata.height ? 0.065 : 0.08)));
        pipeline.extract({ left: 0, top: 0, width: cropWidth, height: metadata.height });
      }
      const result = await pipeline.resize(110, 1000, { fit: 'fill' }).sharpen({ sigma: 0.6 }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
      await mkdir(cacheDirectory, { recursive: true });
      await writeFile(cacheFile, result);
    } catch { /* The cover-derived fallback remains available. */ }
  }

  async spine(id: string): Promise<Buffer | undefined> {
    const cacheDirectory = new URL('../../../.cache/spines-v1/', import.meta.url);
    const cacheFile = new URL(`${encodeURIComponent(id)}.jpg`, cacheDirectory);
    try { return await readFile(cacheFile); } catch { /* Generate it below. */ }
    if (!this.pendingSpines.has(id)) {
      const pending = this.generateSpine(id, cacheFile, cacheDirectory).finally(() => this.pendingSpines.delete(id));
      this.pendingSpines.set(id, pending);
    }
    return undefined;
  }

  streamUrl(trackId: string): string {
    const url = new URL(`Audio/${encodeURIComponent(trackId)}/stream`, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    url.searchParams.set('static', 'true');
    url.searchParams.set('api_key', this.apiKey);
    return url.toString();
  }

  async image(id: string, width: number): Promise<Response> {
    const local = await fetch(this.imageUrl(id, width), { headers: { 'X-Emby-Token': this.apiKey } });
    if (local.ok) return local;
    const userId = await this.user();
    const item = await this.get<JellyfinItem>(`Users/${userId}/Items/${id}`);
    return await this.archiveImage(item, width) ?? local;
  }
}
