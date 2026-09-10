// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { libraryApi } from './api';
import type { AlbumSummary } from './types';

const item = (id: number): AlbumSummary => ({
  id: String(id), title: `Album ${id}`, artist: 'Artist', genres: [], artworkUrl: `/art/${id}`,
  thumbnailUrl: `/thumb/${id}`, backArtworkUrl: '', spineUrl: `/spine/${id}`
});
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('reveals one cover page, waits for an idle moment, then publishes the complete catalogue once', async () => {
  let continueInIdle: (() => void) | undefined;
  vi.stubGlobal('requestIdleCallback', vi.fn((callback: () => void) => { continueInIdle = callback; return 1; }));
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  const first = Array.from({ length: 10 }, (_, index) => item(index));
  const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('start=0') ? json({ items: first, total: 11 }) : json({ items: [item(10)], total: 11 }));
  vi.stubGlobal('fetch', fetcher);
  const onFirstPage = vi.fn();

  const result = libraryApi('jellyfin').albums({ firstPageSize: 10, onFirstPage });
  await vi.waitFor(() => expect(onFirstPage).toHaveBeenCalledWith({ items: first, total: 11 }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  continueInIdle?.();

  await expect(result).resolves.toMatchObject({ total: 11, items: [...first, item(10)] });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onFirstPage).toHaveBeenCalledTimes(1);
});

it('cancels the background catalogue crawl when its source is left', async () => {
  vi.stubGlobal('requestIdleCallback', vi.fn(() => 1));
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  const first = Array.from({ length: 10 }, (_, index) => item(index));
  const fetcher = vi.fn<typeof fetch>(async () => json({ items: first, total: 20 }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const onFirstPage = vi.fn();

  const result = libraryApi('jellyfin').albums({ firstPageSize: 10, onFirstPage, signal: controller.signal });
  await vi.waitFor(() => expect(onFirstPage).toHaveBeenCalledTimes(1));
  controller.abort();

  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
