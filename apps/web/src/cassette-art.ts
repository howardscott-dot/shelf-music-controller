import { useEffect, useState } from 'react';
import type { AlbumSummary } from './types';

export interface CassetteArtwork {
  status: 'pending' | 'found' | 'missing' | 'unavailable';
  retryAfter?: number;
  releaseUrl?: string;
  edition?: string;
  frontUrl?: string;
  backUrl?: string;
  spineUrl?: string;
}
const cache = new Map<string, { value: CassetteArtwork; expires: number }>();
const pending = new Map<string, Promise<CassetteArtwork>>();
async function lookup(key: string): Promise<CassetteArtwork> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (!pending.has(key)) {
    const request = fetch(`/api/cassettes?${key}`).then(async (response) => {
      if (!response.ok) throw new Error('Archive temporarily unavailable');
      const value = await response.json() as CassetteArtwork;
      if (value.status !== 'pending') {
        cache.set(key, { value, expires: Date.now() + (value.status === 'found' ? 1800_000 : 300_000) });
        if (cache.size > 1000) cache.delete(cache.keys().next().value!);
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return pending.get(key)!;
}

export function useCassetteArtwork(album: AlbumSummary | undefined, enabled: boolean): CassetteArtwork | undefined {
  const key = album ? new URLSearchParams({ artist: album.artist, title: album.title }).toString() : '';
  const [result, setResult] = useState<{ key: string; value: CassetteArtwork }>();
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const load = async () => {
      const value = await lookup(key).catch((): CassetteArtwork => ({ status: 'unavailable', retryAfter: 300 }));
      if (cancelled) return;
      setResult({ key, value });
      // Pending scans update without reloading the shelf. Leaving tape mode or
      // scrolling this item away cancels polling; playback is never involved.
      if (value.status === 'pending' && Date.now() - started < 300_000) timer = setTimeout(load, Math.max(2, value.retryAfter ?? 3) * 1000);
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, key]);
  return enabled && result?.key === key ? result.value : undefined;
}
