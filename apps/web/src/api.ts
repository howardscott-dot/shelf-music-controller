import type { AlbumDetail, AlbumIntelligence, AlbumSummary, Crate, GuideResult, OutputDevices, PlaybackState, Source, SourceStatus, SpotifyStatus, SpotifyDevices } from './types';

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

export function libraryApi(source: Source) {
  const prefix = source === 'spotify' ? '/api/spotify' : source === 'plex' ? '/api/plex' : source === 'files' ? '/api/files' : '/api';
  return {
  albums: async () => {
    const items: AlbumSummary[] = [];
    let total = 1;
    while (items.length < total) {
      const page = await request<{ items: AlbumSummary[]; total: number }>(`${prefix}/albums?start=${items.length}&limit=${source === 'spotify' ? 50 : 200}`);
      items.push(...page.items);
      total = page.total;
      if (!page.items.length) break;
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
  crates: () => request<{ items: Crate[] }>('/api/crates'),
  createCrate: (name: string) => request<{ item: Crate }>('/api/crates', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteCrate: (id: string) => request<{ ok: boolean }>(`/api/crates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addToCrate: (crateId: string, album: AlbumSummary, source: Source) => request<{ item: Crate }>(`/api/crates/${encodeURIComponent(crateId)}/albums`, { method: 'POST', body: JSON.stringify({ source, albumId: album.id, title: album.title, artist: album.artist, artworkUrl: album.artworkUrl }) }),
  removeFromCrate: (crateId: string, source: Source, albumId: string) => request<{ item: Crate }>(`/api/crates/${encodeURIComponent(crateId)}/albums/${source}/${encodeURIComponent(albumId)}`, { method: 'DELETE' }),
  recordPlay: (album: AlbumSummary, source: Source) => request<{ ok: boolean }>('/api/history', { method: 'POST', body: JSON.stringify({ source, albumId: album.id, title: album.title, artist: album.artist, artworkUrl: album.artworkUrl }) })
};
