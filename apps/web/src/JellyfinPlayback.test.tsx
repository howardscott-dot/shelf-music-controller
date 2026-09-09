// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { AlbumDetail } from './types';

const mock = vi.hoisted(() => ({ albums: vi.fn(), album: vi.fn(), state: vi.fn(), playTrack: vi.fn(), control: vi.fn(), crates: vi.fn(), recordPlay: vi.fn() }));
vi.mock('./api', () => ({ ApiError: class extends Error {}, libraryApi: () => mock, spotifyApi: { status: async () => ({ connected: false, configured: false }) }, featureApi: { crates: mock.crates, recordPlay: mock.recordPlay } }));
const album: AlbumDetail = { id: 'a'.repeat(32), title: 'Playing album', artist: 'Artist', genres: [], artworkUrl: '/api/artwork/cover?width=720', backArtworkUrl: '/api/artwork/cover?side=back', spineUrl: '', durationSeconds: 360, tracks: [1, 2].map((index) => ({ id: `${index}`.repeat(32), title: `Track ${index}`, artist: 'Artist', album: 'Playing album', disc: 1, index, durationSeconds: 180 })) };
const other = { ...album, id: 'b'.repeat(32), title: 'Browsing album' };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks(); window.localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1024 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 640 });
  mock.albums.mockResolvedValue({ items: [album, other], total: 2 }); mock.album.mockImplementation(async (id: string) => id === album.id ? album : other);
  mock.state.mockResolvedValue({ transport: 'PLAYING', albumId: album.id, trackId: album.tracks[1]!.id, title: 'Track 2', volume: 50, muted: false, durationSeconds: 180, positionSeconds: 1 });
  mock.playTrack.mockResolvedValue({ ok: true }); mock.control.mockResolvedValue({ ok: true });
  mock.crates.mockResolvedValue({ items: [] }); mock.recordPlay.mockResolvedValue({ ok: true });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(element: Element | undefined | null) { expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click()); }
async function open() { await act(async () => root.render(<App />)); await click([...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Jellyfin'))); }
it('uses the server queue for Next after reloading, without needing an open album', async () => {
  await open(); await click(container.querySelector('[aria-label="Next track"]'));
  expect(mock.control).toHaveBeenCalledWith('next', undefined); expect(mock.playTrack).not.toHaveBeenCalled();
});
it('browsing a different album does not change which queue Next and Previous control', async () => {
  await open(); await click([...container.querySelectorAll('.spine')][0]);
  expect(container.querySelector('.cd-media-player')).toBeTruthy();
  await click(container.querySelector('.player-close')); await act(async () => Promise.resolve());
  await click([...container.querySelectorAll('.spine')].find((item) => item.getAttribute('aria-label')?.includes('Browsing album'))); await act(async () => Promise.resolve());
  expect(container.querySelector('.expanded-album')?.getAttribute('aria-label')).toContain('Browsing album');
  await click(container.querySelector('[aria-label="Next track"]')); await click(container.querySelector('[aria-label="Previous track"]'));
  expect(mock.control).toHaveBeenCalledWith('next', undefined); expect(mock.control).toHaveBeenCalledWith('previous', undefined);
  expect(mock.playTrack).not.toHaveBeenCalled();
});
it('shows queue connection problems rather than silently reverting to one-track playback', async () => {
  mock.state.mockResolvedValue({ transport: 'PLAYING', durationSeconds: 180, positionSeconds: 1, volume: 50, muted: false, queueWarning: 'Queue connection interrupted' });
  await open(); expect(container.querySelector('.error[role="status"]')?.textContent).toBe('Queue connection interrupted');
});
