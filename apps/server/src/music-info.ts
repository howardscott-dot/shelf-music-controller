import type { AlbumDetail, Track } from './types.js';

export interface SourcedStory { text: string; sourceName: string; sourceUrl: string }
export interface LibraryLyrics { plain: string; sourceName: string; sourceUrl?: string }
export interface TrackIntelligence { track: Track; story?: SourcedStory; lyrics?: LibraryLyrics; note: string }

type Fetcher = typeof fetch;

interface WikiPage { title?: string; extract?: string; fullurl?: string }
interface LyricsResult { plainLyrics?: string; syncedLyrics?: string; instrumental?: boolean }

function normalized(value: string) { return value.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim(); }

function conciseExtract(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 1_300) return clean;
  const shortened = clean.slice(0, 1_300);
  const sentence = Math.max(shortened.lastIndexOf('. '), shortened.lastIndexOf('! '), shortened.lastIndexOf('? '));
  return `${shortened.slice(0, sentence > 700 ? sentence + 1 : 1_250).trim()}…`;
}

function plainFromSynced(value?: string) {
  return value?.split('\n').map((line) => line.replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '')).join('\n').trim();
}

export class MusicInfoService {
  private readonly stories = new Map<string, Promise<SourcedStory | undefined>>();
  private readonly lyrics = new Map<string, Promise<LibraryLyrics | undefined>>();
  constructor(private readonly fetcher: Fetcher = fetch) {}

  albumStory(album: AlbumDetail) { return this.story('album', album.title, album.artist); }

  async trackInfo(track: Track, localLyrics?: LibraryLyrics): Promise<TrackIntelligence> {
    const [story, publicLyrics] = await Promise.all([
      this.story('song', track.title, track.artist),
      localLyrics ? Promise.resolve(undefined) : this.publicLyrics(track)
    ]);
    return {
      track,
      story,
      lyrics: localLyrics ?? publicLyrics,
      note: 'Stories are shown only when SHELF finds a matching published source. Lyrics come from the connected library first, then LRCLIB when available.'
    };
  }

  private story(kind: 'album' | 'song', title: string, artist: string) {
    const key = `${kind}:${normalized(artist)}:${normalized(title)}`;
    const existing = this.stories.get(key);
    if (existing) return existing;
    const pending = this.fetchStory(kind, title, artist).catch(() => undefined);
    this.stories.set(key, pending);
    return pending;
  }

  private async fetchStory(kind: 'album' | 'song', title: string, artist: string): Promise<SourcedStory | undefined> {
    if (!title || !artist || normalized(artist) === 'unknown artist') return;
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', `"${title}" "${artist}" ${kind}`);
    url.searchParams.set('gsrlimit', '5');
    url.searchParams.set('prop', 'extracts|info');
    url.searchParams.set('exintro', '1');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    const response = await this.fetcher(url, { headers: { 'User-Agent': 'SHELF/0.1 (https://github.com/howardscott-dot/shelf-music-controller)' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return;
    const value = await response.json() as { query?: { pages?: Record<string, WikiPage> } };
    const wantedTitle = normalized(title); const wantedArtist = normalized(artist);
    const candidates = Object.values(value.query?.pages ?? {}).map((page) => {
      const pageTitle = normalized(page.title ?? ''); const extract = normalized(page.extract ?? '');
      let score = 0;
      if (pageTitle === wantedTitle) score += 6; else if (pageTitle.includes(wantedTitle)) score += 4;
      if (extract.includes(wantedTitle)) score += 2;
      if (pageTitle.includes(wantedArtist)) score += 3;
      if (extract.includes(wantedArtist)) score += 4;
      if (pageTitle.includes('disambiguation')) score -= 10;
      return { page, score };
    }).sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best || best.score < 6 || !best.page.extract || !best.page.fullurl) return;
    return { text: conciseExtract(best.page.extract), sourceName: 'Wikipedia', sourceUrl: best.page.fullurl };
  }

  private publicLyrics(track: Track) {
    const key = `${normalized(track.artist)}:${normalized(track.album)}:${normalized(track.title)}:${track.durationSeconds}`;
    const existing = this.lyrics.get(key);
    if (existing) return existing;
    const pending = this.fetchLyrics(track).catch(() => undefined);
    this.lyrics.set(key, pending);
    return pending;
  }

  private async fetchLyrics(track: Track): Promise<LibraryLyrics | undefined> {
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('track_name', track.title);
    url.searchParams.set('artist_name', track.artist);
    if (track.album) url.searchParams.set('album_name', track.album);
    if (track.durationSeconds) url.searchParams.set('duration', String(Math.round(track.durationSeconds)));
    const response = await this.fetcher(url, { headers: { 'User-Agent': 'SHELF/0.1 (https://github.com/howardscott-dot/shelf-music-controller)' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return;
    const value = await response.json() as LyricsResult;
    if (value.instrumental) return { plain: 'Instrumental track.', sourceName: 'LRCLIB', sourceUrl: url.toString() };
    const plain = value.plainLyrics?.trim() || plainFromSynced(value.syncedLyrics);
    return plain ? { plain, sourceName: 'LRCLIB', sourceUrl: url.toString() } : undefined;
  }
}
