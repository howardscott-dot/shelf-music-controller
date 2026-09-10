import type { AlbumDetail, AlbumIntelligence, AlbumSummary, Crate, GuideResult, OutputDevices, PlaybackState, Source, SourceStatus, SpotifyStatus, SpotifyDevices, SourcedStory, TrackIntelligence } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError('SHELF cannot reach its server. Check the connection and try again.', 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    const proxyFailure = response.status === 500 && !body.error;
    throw new ApiError(proxyFailure
      ? 'SHELF backend is unavailable. Create and configure the project .env file, then restart npm run dev.'
      : body.error ?? `Request failed (${response.status})`, response.status, Number(response.headers.get('Retry-After')) || 0);
  }
  return response.json() as Promise<T>;
}

function waitForBrowseIdle(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const browser = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    let timerId: number | undefined;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      if (idleId !== undefined) browser.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
    const finish = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (browser.requestIdleCallback) idleId = browser.requestIdleCallback(finish, { timeout: 1_200 });
    else timerId = window.setTimeout(finish, 350);
  });
}

export function libraryApi(source: Source) {
  const prefix = source === 'spotify' ? '/api/spotify' : source === 'plex' ? '/api/plex' : source === 'files' ? '/api/files' : '/api';
  return {
  albums: async (options?: { firstPageSize?: number; onFirstPage?: (value: { items: AlbumSummary[]; total: number }) => void; signal?: AbortSignal }) => {
    const items: AlbumSummary[] = [];
    let total = 1;
    let first = true;
    while (items.length < total) {
      const firstPage = first;
      const limit = first && options?.firstPageSize ? options.firstPageSize : source === 'spotify' ? 50 : 200;
      const page = await request<{ items: AlbumSummary[]; total: number }>(`${prefix}/albums?start=${items.length}&limit=${limit}`, { signal: options?.signal });
      items.push(...page.items);
      total = page.total;
      if (firstPage && options?.onFirstPage) options.onFirstPage({ items: [...items], total });
      first = false;
      if (!page.items.length) break;
      if (options?.firstPageSize && items.length < total) await waitForBrowseIdle(options.signal);
    }
    return { items, total };
  },
  album: (id: string) => request<AlbumDetail>(`${prefix}/albums/${encodeURIComponent(id)}`),
  state: () => request<PlaybackState>(`${prefix}/playback`),
  playTrack: (trackId: string, albumId: string) => request<{ ok: boolean }>(`${prefix}/playback/track/${encodeURIComponent(trackId)}`, { method: 'POST', body: JSON.stringify({ albumId }) }),
  control: (action: string, body: object = {}) => request<{ ok: boolean }>(`${prefix}/playback/${action}`, { method: 'POST', body: JSON.stringify(body) })
  };
}

export const spotifyApi = {
  status: () => request<SpotifyStatus>('/api/spotify/status'),
  devices: () => request<SpotifyDevices>('/api/spotify/devices'),
  device: (id: string) => request('/api/spotify/devices', { method: 'POST', body: JSON.stringify({ id }) }),
  disconnect: () => request('/api/spotify/disconnect', { method: 'POST', body: '{}' }),
  search: (query: string, start = 0) => request<{ items: AlbumSummary[]; total: number }>(`/api/spotify/search?q=${encodeURIComponent(query)}&start=${start}`)
};

export const sourceApi = { status: () => request<SourceStatus>('/api/sources/status') };
export const outputApi = {
  devices: () => request<OutputDevices>('/api/outputs/'),
  discover: () => request<OutputDevices>('/api/outputs/discover', { method: 'POST', body: '{}' }),
  select: (id: string) => request('/api/outputs/select', { method: 'POST', body: JSON.stringify({ id }) }),
  manual: (address: string) => request<OutputDevices>('/api/outputs/manual', { method: 'POST', body: JSON.stringify({ address }) })
};

export const featureApi = {
  guide: (query: string, source: Source) => request<GuideResult>(`/api/guide?q=${encodeURIComponent(query)}&source=${source}`),
  intelligence: (source: Source, id: string) => request<AlbumIntelligence>(`/api/intelligence/${source}/${encodeURIComponent(id)}`),
  albumStory: (source: Source, id: string) => request<{ story?: SourcedStory }>(`/api/intelligence/${source}/${encodeURIComponent(id)}/story`),
  trackIntelligence: (source: Source, albumId: string, trackId: string) => request<TrackIntelligence>(`/api/intelligence/${source}/${encodeURIComponent(albumId)}/tracks/${encodeURIComponent(trackId)}`),
  crates: () => request<{ items: Crate[] }>('/api/crates'),
  createCrate: (name: string) => request<{ item: Crate }>('/api/crates', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteCrate: (id: string) => request<{ ok: boolean }>(`/api/crates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addToCrate: (crateId: string, album: AlbumSummary, source: Source) => request<{ item: Crate }>(`/api/crates/${encodeURIComponent(crateId)}/albums`, { method: 'POST', body: JSON.stringify({ source, albumId: album.id, title: album.title, artist: album.artist, artworkUrl: album.artworkUrl }) }),
  removeFromCrate: (crateId: string, source: Source, albumId: string) => request<{ item: Crate }>(`/api/crates/${encodeURIComponent(crateId)}/albums/${source}/${encodeURIComponent(albumId)}`, { method: 'DELETE' }),
  recordPlay: (album: AlbumSummary, source: Source) => request<{ ok: boolean }>('/api/history', { method: 'POST', body: JSON.stringify({ source, albumId: album.id, title: album.title, artist: album.artist, artworkUrl: album.artworkUrl }) })
};
