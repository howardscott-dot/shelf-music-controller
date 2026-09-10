// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { Shelf } from './components/Shelf';
import type { AlbumDetail } from './types';

const mock = vi.hoisted(() => ({
  status: vi.fn(), albums: vi.fn(), album: vi.fn(), state: vi.fn(), playTrack: vi.fn(), control: vi.fn(), search: vi.fn(), devices: vi.fn(), device: vi.fn(), disconnect: vi.fn(), cassette: vi.fn(), crates: vi.fn(), guide: vi.fn(), intelligence: vi.fn(), albumStory: vi.fn(), trackIntelligence: vi.fn(), createCrate: vi.fn(), deleteCrate: vi.fn(), addToCrate: vi.fn(), removeFromCrate: vi.fn(), recordPlay: vi.fn(), outputDevices: vi.fn(), discoverOutputs: vi.fn(), selectOutput: vi.fn(), manualOutput: vi.fn()
}));
vi.mock('./cassette-art', () => ({ useCassetteArtwork: (album: unknown, enabled: boolean) => album && enabled ? mock.cassette(album) : undefined }));
vi.mock('./api', () => ({
  ApiError: class extends Error {},
  libraryApi: () => ({ albums: mock.albums, album: mock.album, state: mock.state, playTrack: mock.playTrack, control: mock.control }),
  spotifyApi: { status: mock.status, search: mock.search, devices: mock.devices, device: mock.device, disconnect: mock.disconnect }
  ,sourceApi: { status: mock.status }
  ,outputApi: { devices: mock.outputDevices, discover: mock.discoverOutputs, select: mock.selectOutput, manual: mock.manualOutput }
  ,featureApi: { crates: mock.crates, guide: mock.guide, intelligence: mock.intelligence, albumStory: mock.albumStory, trackIntelligence: mock.trackIntelligence, createCrate: mock.createCrate, deleteCrate: mock.deleteCrate, addToCrate: mock.addToCrate, removeFromCrate: mock.removeFromCrate, recordPlay: mock.recordPlay }
}));

const album: AlbumDetail = { id: 'a'.repeat(22), title: 'A Real Album', artist: 'An Artist', genres: [], source: 'spotify', artworkUrl: 'https://i.scdn.co/image/unaltered', backArtworkUrl: '', spineUrl: '', externalUrl: 'https://open.spotify.com/album/test', durationSeconds: 180, tracks: [{ id: 't'.repeat(22), title: 'Track one', artist: 'An Artist', album: 'A Real Album', index: 1, disc: 1, durationSeconds: 180 }] };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1024 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.resetAllMocks();
  mock.status.mockResolvedValue({ jellyfin: { configured: true, connected: true }, spotify: { configured: true, connected: true, connectUrl: 'http://127.0.0.1:8787/api/spotify/connect' }, plex: { configured: false }, files: { configured: false } });
  mock.albums.mockResolvedValue({ items: [album], total: 1 });
  mock.album.mockResolvedValue(album);
  mock.state.mockResolvedValue({ transport: 'STOPPED', positionSeconds: 0, durationSeconds: 0, volume: 50, muted: false });
  mock.playTrack.mockResolvedValue({ ok: true }); mock.control.mockResolvedValue({ ok: true });
  mock.crates.mockResolvedValue({ items: [] }); mock.recordPlay.mockResolvedValue({ ok: true });
  mock.albumStory.mockResolvedValue({}); mock.trackIntelligence.mockResolvedValue({ track: album.tracks[0], note: 'Only sourced material.' });
  mock.devices.mockResolvedValue({ devices: [{ id: 'wiim', name: 'WiiM Pro', active: false, restricted: false }] });
  mock.device.mockResolvedValue({ ok: true });
  mock.discoverOutputs.mockResolvedValue({ devices: [{ id: 'wiim', name: 'WiiM Pro', address: '192.0.2.2', origin: 'configured', selected: true, protocol: 'UPnP / DLNA' }], selectedId: 'wiim' });
  mock.selectOutput.mockResolvedValue({ ok: true }); mock.manualOutput.mockResolvedValue({ devices: [] });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<App />)); }
async function click(element: Element | null | undefined) { expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click()); }
const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));

describe('launch and source isolation', () => {
  it('always starts with source choices; Apple Music is honestly marked coming soon', async () => {
    await render();
    expect(container.textContent).toContain('Where shall we listen?');
    expect(button('Apple Music')?.disabled).toBe(true);
    expect(button('Apple Music')?.textContent).toContain('COMING SOON');
    expect(mock.albums).not.toHaveBeenCalled(); expect(mock.control).not.toHaveBeenCalled();
  });
  it('keeps Jellyfin accessible when Spotify is not configured', async () => {
    mock.status.mockResolvedValue({ jellyfin: { configured: true }, spotify: { configured: false, connected: false }, plex: { configured: false }, files: { configured: false } });
    await render(); await click(button('Jellyfin'));
    expect(container.querySelector('.shelf')).toBeTruthy(); expect(mock.albums).toHaveBeenCalledTimes(1);
  });
  it('opens the selected cover immediately while Jellyfin loads its tracks', async () => {
    const localAlbum = { ...album, source: 'jellyfin' as const };
    let finish!: (value: AlbumDetail) => void;
    mock.album.mockReturnValueOnce(new Promise<AlbumDetail>((resolve) => { finish = resolve; }));
    mock.albums.mockResolvedValueOnce({ items: [localAlbum], total: 1 });
    await render(); await click(button('Jellyfin')); await act(async () => Promise.resolve());
    await click(container.querySelector('.spine'));
    expect(container.querySelector('.expanded-album')).toBeTruthy();
    expect(container.querySelector('.cover-play')?.hasAttribute('disabled')).toBe(true);
    await act(async () => finish(localAlbum));
    expect(container.querySelector('.cover-play')?.hasAttribute('disabled')).toBe(false);
  });
  it('shows the physical player immediately while the network player starts', async () => {
    const localAlbum = { ...album, source: 'jellyfin' as const };
    let finish!: (value: { ok: boolean }) => void;
    mock.albums.mockResolvedValueOnce({ items: [localAlbum], total: 1 });
    mock.album.mockResolvedValueOnce(localAlbum);
    mock.playTrack.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await render(); await click(button('Jellyfin')); await click(container.querySelector('.spine')); await click(container.querySelector('.cover-play'));
    expect(container.querySelector('.active-media-player')).toBeTruthy();
    expect(container.textContent).toContain('STARTING');
    await act(async () => finish({ ok: true }));
  });
  it('shows real setup instructions, not a fake Spotify collection, before connection', async () => {
    mock.status.mockResolvedValue({ jellyfin: { configured: true }, spotify: { configured: false, connected: false }, plex: { configured: false }, files: { configured: false } });
    await render(); await click(button('Spotify'));
    expect(container.textContent).toContain('Client ID');
    expect(container.textContent).toContain('http://127.0.0.1:8787/api/spotify/callback');
    expect(mock.albums).not.toHaveBeenCalled();
  });
  it('offers configured Plex and mounted-folder collections without pretending unavailable sources work', async () => {
    mock.status.mockResolvedValue({ jellyfin: { configured: true }, spotify: { configured: true, connected: true, connectUrl: '/connect' }, plex: { configured: true, connected: true }, files: { configured: true, connected: true, albums: 42 } });
    await render(); expect(button('Plex')?.disabled).toBe(false); expect(button('Music files')?.disabled).toBe(false); expect(container.textContent).toContain('OPEN 42 ALBUMS');
  });
  it('switches back to the chooser without stopping playback and clears selected albums', async () => {
    await render(); await click(button('Spotify')); await click(container.querySelector('.spine'));
    expect(container.querySelector('.spotify-album')).toBeTruthy();
    await click(container.querySelector('[aria-label="Choose music source"]'));
    expect(container.textContent).toContain('Where shall we listen?');
    await click(button('Jellyfin'));
    expect(container.querySelector('.expanded-album')).toBeNull();
    expect(mock.control).not.toHaveBeenCalled(); expect(mock.playTrack).not.toHaveBeenCalled();
  });
});

describe('Spotify shelf and footer', () => {
  it('renders unaltered covers without back-cover requests or artwork overlays', async () => {
    await render(); await click(button('Spotify')); await click(container.querySelector('.spine'));
    expect(container.querySelector('.spotify-album img')?.getAttribute('src')).toBe(album.artworkUrl);
    expect(container.querySelector('.cover-flip')).toBeNull(); expect(container.querySelector('.cover-play')).toBeNull();
    expect(container.querySelector('img[alt="Spotify"]')).toBeTruthy();
    expect(container.querySelector('.spotify-attribution')?.getAttribute('href')).toBe(album.externalUrl);
  });
  it('plays the selected album from the footer and sends next/shuffle to Spotify', async () => {
    await render(); await click(button('Spotify')); await click(container.querySelector('.spine'));
    await click(container.querySelector('[aria-label="Play selected album"]'));
    expect(mock.playTrack).toHaveBeenCalledWith(album.tracks[0].id, album.id);
    await click(container.querySelector('[aria-label="Next track"]'));
    expect(mock.control).toHaveBeenCalledWith('next', undefined);
    await click(container.querySelector('[aria-label="Toggle Spotify shuffle"]'));
    expect(mock.control).toHaveBeenCalledWith('shuffle', { enabled: true });
  });
  it('keeps the playing album artwork in the footer while another album is selected', async () => {
    const playing = { ...album, id: 'playing', title: 'Playing now', thumbnailUrl: '/playing-thumb.jpg' };
    const browsing = { ...album, id: 'browsing', title: 'Browsing next', thumbnailUrl: '/browsing-thumb.jpg' };
    mock.albums.mockResolvedValue({ items: [playing, browsing], total: 2 });
    mock.album.mockResolvedValue({ ...browsing, tracks: album.tracks });
    mock.state.mockResolvedValue({ transport: 'PLAYING', albumId: playing.id, trackId: 'playing-track', title: 'Current song', artist: playing.artist, album: playing.title, artworkUrl: '/playing-full.jpg', positionSeconds: 20, durationSeconds: 180, volume: 50, muted: false });
    await render(); await click(button('Spotify')); await click(container.querySelectorAll('.spine')[1]);
    expect(container.querySelector('.now-art img')?.getAttribute('src')).toBe('/playing-thumb.jpg');
    expect(container.querySelector('.now-copy strong')?.textContent).toBe('Current song');
  });
  it('chooses a device without playing, and maintains accessible large buttons', async () => {
    await render(); await click(button('Spotify')); await click(button('DEVICES'));
    expect(container.querySelector('dialog')?.open).toBe(true);
    await click(button('WiiM Pro'));
    expect(mock.device).toHaveBeenCalledWith('wiim'); expect(mock.playTrack).not.toHaveBeenCalled();
  });
  it('uses the touch keyboard to filter and can clear the filter', async () => {
    await render(); await click(button('Spotify')); await click(container.querySelector('[aria-label="Search albums"]'));
    await click([...container.querySelectorAll('.key-row button')].find((item) => item.textContent === 'Z'));
    expect(container.textContent).toContain('NO ALBUMS MATCH');
    await click([...container.querySelectorAll('button')].find((item) => item.textContent === 'CLEAR FILTER'));
    expect(container.querySelector('.spine')).toBeTruthy();
  });
  it('searches the catalogue only on explicit submission, then returns to saved albums', async () => {
    mock.search.mockResolvedValue({ items: [{ ...album, title: 'Catalogue match' }], total: 1 });
    await render(); await click(button('Spotify')); await click(container.querySelector('[aria-label="Search albums"]'));
    await click([...container.querySelectorAll('.key-row button')].find((item) => item.textContent === 'A'));
    expect(mock.search).not.toHaveBeenCalled(); await click(button('SEARCH SPOTIFY CATALOGUE'));
    expect(mock.search).toHaveBeenCalledWith('a', 0); expect(container.textContent).toContain('Catalogue match');
    await click(button('SAVED ALBUMS')); expect(container.textContent).toContain('A Real Album');
  });
  it('keeps at most twenty Spotify albums in each content set, with explicit pagination', async () => {
    mock.albums.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => ({ ...album, id: String(i), title: `Album ${i}` })), total: 25 });
    await render(); await click(button('Spotify'));
    expect(container.querySelectorAll('.spine')).toHaveLength(20);
    await click(container.querySelector('[aria-label="Next albums"]'));
    expect(container.querySelectorAll('.spine')).toHaveLength(5); expect(container.textContent).toContain('21–25 of 25');
  });
  it('leaves the Jellyfin cover and flip controls intact', async () => {
    const localAlbum = { ...album, source: 'jellyfin' as const, artworkUrl: '/api/artwork/local?width=1200', backArtworkUrl: '/api/artwork/local?side=back' };
    await act(async () => root.render(<Shelf albums={[localAlbum]} selected={localAlbum} onSelect={() => {}} onClose={() => {}} onPlay={() => {}} />));
    expect(container.querySelector('.cover-front img')).toBeTruthy(); expect(container.querySelector('.cover-flip')).toBeTruthy(); expect(container.querySelector('.cover-play')).toBeTruthy();
  });
  it('builds valid front-cover URLs for mounted files without inventing a back cover', async () => {
    const fileAlbum = { ...album, source: 'files' as const, artworkUrl: '/api/files/artwork/local', backArtworkUrl: '' };
    await act(async () => root.render(<Shelf albums={[fileAlbum]} selected={fileAlbum} onSelect={() => {}} onClose={() => {}} onPlay={() => {}} />));
    expect(container.querySelector('.cover-front img')?.getAttribute('src')).toBe('/api/files/artwork/local?v=5');
    expect(container.querySelector('.cover-back img')).toBeNull();
    expect(container.querySelector('.cover-flip')?.getAttribute('title')).toBe('No genuine back-cover scan found');
  });
});

describe('local network outputs', () => {
  it('discovers and selects a named UPnP player without starting music', async () => {
    await render(); await click(button('Jellyfin')); await click(container.querySelector('[aria-label="Choose playback output"]'));
    expect(container.textContent).toContain('NETWORK PLAYERS'); expect(container.textContent).toContain('WiiM Pro');
    await click(button('WiiM Pro')); expect(mock.selectOutput).toHaveBeenCalledWith('wiim'); expect(mock.playTrack).not.toHaveBeenCalled();
  });
});

describe('guide, album intelligence and quiet shelf tools', () => {
  it('turns a natural-language request into a shelf of matching records', async () => {
    const guided = { ...album, id: 'g'.repeat(22), title: 'A Guided Record' };
    mock.guide.mockResolvedValue({ items: [guided], interpretation: 'Looking for atmospheric character · the 1990s.', shouldPlay: false });
    await render(); await click(button('Spotify')); await click(container.querySelector('[aria-label="Search albums"]')); await click(button('MUSIC GUIDE')); await click(button('Atmospheric from the 1990s')); await click(button('ASK SHELF'));
    expect(mock.guide).toHaveBeenCalledWith('Atmospheric from the 1990s', 'spotify');
    expect(container.textContent).toContain('A Guided Record'); expect(mock.playTrack).not.toHaveBeenCalled();
  });
  it('opens grounded album intelligence without interrupting playback', async () => {
    mock.intelligence.mockResolvedValue({ album, related: [], listening: { plays: 2, lastPlayedAt: '2026-09-07T08:00:00.000Z' }, context: 'Released in 1996. 1 track.', credits: ['An Artist'], linerNotes: 'No publisher-supplied liner notes are present.', note: 'Metadata only.' });
    await render(); await click(button('Spotify')); await click(container.querySelector('.spine')); await click(container.querySelector('[aria-label="Open album and song information"]'));
    expect(container.textContent).toContain('ALBUM INTELLIGENCE'); expect(container.textContent).toContain('LINER NOTES'); expect(container.textContent).toContain('2 plays through SHELF'); expect(mock.control).not.toHaveBeenCalled();
  });
  it('keeps information in the footer and loads lyrics only for a chosen song', async () => {
    mock.intelligence.mockResolvedValue({ album, related: [], listening: { plays: 0 }, context: 'One track.', credits: [], linerNotes: 'None.', note: 'Metadata only.' });
    mock.trackIntelligence.mockResolvedValue({ track: album.tracks[0], lyrics: { plain: 'A line of lyrics', sourceName: 'Test library' }, note: 'Only sourced material.' });
    await render(); await click(button('Spotify')); await click(container.querySelector('.spine'));
    const info = container.querySelector('[aria-label="Open album and song information"]');
    expect(info?.closest('.footer-tools')).toBeTruthy();
    await click(info); await click(button('SONGS & LYRICS')); await click(button('Track one'));
    expect(mock.trackIntelligence).toHaveBeenCalledWith('spotify', album.id, album.tracks[0].id);
    expect(container.textContent).toContain('A line of lyrics');
  });
  it('keeps atmosphere local and exposes the LAN API behind one tools control', async () => {
    await render(); await click(button('Spotify')); await click(container.querySelector('[aria-label="Open crates, atmosphere and local API"]')); await click(button('ATMOSPHERE')); await click(button('MIDNIGHT'));
    expect(container.querySelector('main')?.getAttribute('data-environment')).toBe('midnight'); expect(window.localStorage.getItem('shelf.environment')).toBe('midnight');
    await click(button('API')); expect(container.textContent).toContain('/api/control/v1');
  });
});

describe('CD, tape and cover appearance', () => {
  it('defaults to CDs and remembers tape and cover choices from launch', async () => {
    await render();
    expect(button('CD SPINES')?.getAttribute('aria-pressed')).toBe('true');
    await click(button('TAPES'));
    expect(window.localStorage.getItem('shelf.spine-style')).toBe('tape');
    await click(button('COVERS'));
    expect(window.localStorage.getItem('shelf.spine-style')).toBe('covers');
    await click(button('Spotify'));
    expect(container.querySelector('.covers-browser')?.getAttribute('data-spine-style')).toBe('covers');
    expect(container.querySelector('.cover-tile')).toBeTruthy();
    expect(mock.control).not.toHaveBeenCalled();
  });
  it('starts an older iPad in the lightweight cover view when it has no saved choice', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X)');
    vi.spyOn(window.screen, 'width', 'get').mockReturnValue(768);
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(1024);
    await render();
    expect(button('COVERS')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('restores the style across a new visit, with CD fallback for invalid preferences', async () => {
    window.localStorage.setItem('shelf.spine-style', 'covers');
    await render(); expect(button('COVERS')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => root.render(null));
    window.localStorage.setItem('shelf.spine-style', 'unknown');
    await render(); expect(button('CD SPINES')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('changes appearance without restarting playback, refetching albums, or closing the cover', async () => {
    await render(); await click(button('Spotify')); await click(container.querySelector('.spine'));
    const cover = container.querySelector('.expanded-album') as HTMLElement;
    const width = cover.style.width;
    await click(container.querySelector('.footer-format'));
    expect(container.querySelector('.expanded-album')).toBe(cover);
    expect(cover.style.width).toBe(width);
    expect(container.querySelector('.spotify-album img')?.getAttribute('src')).toBe(album.artworkUrl);
    expect(mock.albums).toHaveBeenCalledTimes(1);
    expect(mock.control).not.toHaveBeenCalled(); expect(mock.playTrack).not.toHaveBeenCalled();
    await click(container.querySelector('[aria-label="Choose music source"]'));
    await click(button('Jellyfin'));
    expect(container.querySelector('.tape-shelf')).toBeTruthy();
  });
  it('keeps the same browsing position when the spine widths change', async () => {
    mock.albums.mockResolvedValue({ items: Array.from({ length: 20 }, (_, i) => ({ ...album, id: String(i) })), total: 20 });
    await render(); await click(button('Spotify'));
    const shelf = container.querySelector('.shelf') as HTMLElement;
    await act(async () => { shelf.scrollLeft = 220; shelf.dispatchEvent(new Event('scroll')); });
    await click(container.querySelector('.footer-format'));
    expect(shelf.scrollLeft).toBe(320);
    await click(container.querySelector('.footer-format'));
    expect(container.querySelectorAll('.cover-tile')).toHaveLength(10);
    await click(container.querySelector('.footer-format'));
    expect(container.querySelector('.shelf')).toBeTruthy();
  });
  it('still switches styles if browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    await render(); await click(button('TAPES')); await click(button('Spotify'));
    expect(container.querySelector('.tape-shelf')).toBeTruthy();
  });
  it('renders only one lightweight cover page and opens a static selected cover', async () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ ...album, source: 'jellyfin' as const, id: String(i), title: `Album ${i}`, thumbnailUrl: `/thumb/${i}` }));
    mock.albums.mockResolvedValue({ items, total: items.length });
    mock.album.mockImplementation(async (id: string) => ({ ...items[Number(id)]!, tracks: album.tracks, durationSeconds: 180 }));
    await render(); await click(button('COVERS')); await click(button('Jellyfin'));
    expect(container.querySelectorAll('.cover-tile')).toHaveLength(10);
    expect(container.querySelector('.cover-tile img')?.getAttribute('src')).toBe('/thumb/0');
    expect(container.textContent).toContain('Album 0'); expect(container.textContent).not.toContain('Album 10');
    await click(container.querySelector('[aria-label="Next album page"]'));
    expect(container.querySelectorAll('.cover-tile')).toHaveLength(10);
    expect(container.textContent).toContain('Album 10'); expect(container.textContent).toContain('11–20 / 23');
    await click(container.querySelector('.cover-tile'));
    expect(container.querySelector('.covers-focus')).toBeTruthy();
    expect(container.querySelector('.active-media-player')).toBeNull();
    expect(container.querySelector('.cd-disc')).toBeNull(); expect(container.querySelector('.playing-cassette')).toBeNull();
    await click(container.querySelector('[aria-label="Play selected album"]'));
    expect(mock.playTrack).toHaveBeenCalledWith(album.tracks[0]!.id, '10');
  });
  it('loads the first cover page progressively and preserves a later selection when returning to CDs', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ ...album, id: String(i), title: `Album ${i}`, thumbnailUrl: `/thumb/${i}` }));
    mock.albums.mockResolvedValue({ items, total: items.length });
    mock.album.mockImplementation(async (id: string) => ({ ...items[Number(id)]!, tracks: album.tracks, durationSeconds: 180 }));
    await render(); await click(button('COVERS')); await click(button('Spotify'));
    expect(mock.albums.mock.calls[0]?.[0]?.firstPageSize).toBe(10);
    expect(typeof mock.albums.mock.calls[0]?.[0]?.onFirstPage).toBe('function');
    expect(mock.albums.mock.calls[0]?.[0]?.signal).toBeInstanceOf(AbortSignal);
    await click(container.querySelector('[aria-label="Next album page"]'));
    await click(container.querySelector('[aria-label="Next album page"]'));
    await click(container.querySelector('.cover-tile'));
    expect(container.textContent).toContain('Album 20');
    await click(container.querySelector('.footer-format'));
    expect(container.querySelector('.spotify-album')).toBeTruthy();
    expect(container.querySelector('.spotify-album')?.getAttribute('aria-label')).toContain('Album 20');
  });
  it('locks cover-page controls while the next Spotify search page is loading', async () => {
    const first = Array.from({ length: 10 }, (_, i) => ({ ...album, id: String(i), title: `Result ${i}` }));
    const second = Array.from({ length: 10 }, (_, i) => ({ ...album, id: String(i + 10), title: `Result ${i + 10}` }));
    let finish!: (value: { items: typeof second; total: number }) => void;
    mock.search.mockResolvedValueOnce({ items: first, total: 20 }).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(); await click(button('COVERS')); await click(button('Spotify'));
    await click(container.querySelector('[aria-label="Search albums"]'));
    await click([...container.querySelectorAll('.key-row button')].find((item) => item.textContent === 'A'));
    await click(button('SEARCH SPOTIFY CATALOGUE'));
    const next = container.querySelector('[aria-label="Next album page"]') as HTMLButtonElement;
    await click(next);
    expect(next.disabled).toBe(true);
    next.click();
    expect(mock.search).toHaveBeenCalledTimes(2);
    await act(async () => finish({ items: second, total: 20 }));
    expect(container.textContent).toContain('Result 10');
  });
  it('preserves Jellyfin front/back controls and adds tape labels without changing metadata', async () => {
    const localAlbum = { ...album, source: 'jellyfin' as const, artworkUrl: '/api/artwork/local?width=1200', backArtworkUrl: '/api/artwork/local?side=back' };
    await act(async () => root.render(<Shelf albums={[localAlbum, { ...localAlbum, id: 'other' }]} selected={localAlbum} spineStyle="tape" onSelect={() => {}} onClose={() => {}} onPlay={() => {}} />));
    expect(container.querySelector('.cover-flip')).toBeTruthy(); expect(container.querySelector('.cover-play')).toBeTruthy();
    expect(container.querySelector('.tape-spine .spine-title')?.textContent).toBe(album.title);
    expect(container.querySelector('.tape-spine .spine-artist')?.textContent).toBe(album.artist);
  });
});

describe('genuine cassette scans', () => {
  const artwork = { status: 'found', frontUrl: '/api/cassette-assets/release/1/cover', backUrl: '/api/cassette-assets/release/2/cover', spineUrl: '/api/cassette-assets/release/3/spine', releaseUrl: 'https://musicbrainz.org/release/test/cover-art', edition: 'Cassette · GB · 1993' };
  it.each(['spotify', 'jellyfin'] as const)('shows cassette packaging for %s, keeping its attribution and the full image', async (source) => {
    mock.cassette.mockReturnValue(artwork);
    const local = { ...album, source };
    await act(async () => root.render(<Shelf albums={[local]} selected={local} spineStyle="tape" onSelect={() => {}} onClose={() => {}} onPlay={() => {}} />));
    expect(container.querySelector('.cassette-album')).toBeTruthy();
    expect(container.querySelector('.cover-front img')?.getAttribute('src')).toBe(artwork.frontUrl);
    expect(container.querySelector('.cover-back img')?.getAttribute('src')).toBe(artwork.backUrl);
    expect(container.querySelector('.cassette-caption a')?.getAttribute('href')).toBe(artwork.releaseUrl);
    const backImage = container.querySelector('.cover-back img')!;
    await act(async () => backImage.dispatchEvent(new Event('load')));
    await click(container.querySelector('.cassette-flip'));
    expect(container.querySelector('.cassette-album.flipped')).toBeTruthy();
    expect(mock.playTrack).not.toHaveBeenCalled();
  });
  it('does not request cassette scans in CD mode', async () => {
    mock.cassette.mockReturnValue(artwork);
    await render(); await click(button('Spotify')); await click(container.querySelector('.spine'));
    expect(mock.cassette).not.toHaveBeenCalled();
    expect(container.querySelector('.spotify-album img')?.getAttribute('src')).toBe(album.artworkUrl);
  });
  it('keeps text readable until the real spine loads and falls back quietly on image failure', async () => {
    mock.cassette.mockReturnValue(artwork);
    await render(); await click(button('TAPES')); await click(button('Spotify'));
    expect(container.querySelector('.spine-title')?.textContent).toBe(album.title);
    const image = container.querySelector('.cassette-spine-image')!;
    await act(async () => image.dispatchEvent(new Event('load')));
    expect(container.querySelector('.cassette-scan-spine')).toBeTruthy(); expect(container.querySelector('.spine-title')).toBeNull();
    await act(async () => image.dispatchEvent(new Event('error')));
    expect(container.querySelector('.spine-title')?.textContent).toBe(album.title);
    expect(container.querySelector('.cassette-spine-image')).toBeNull();
  });
  it('does not invent a back-cover button or claim the album cover is a cassette scan when the scan fails', async () => {
    mock.cassette.mockReturnValue({ ...artwork, backUrl: undefined });
    await render(); await click(button('TAPES')); await click(button('Spotify')); await click(container.querySelector('.spine'));
    expect(container.querySelector('.cassette-flip')).toBeNull();
    await act(async () => container.querySelector('.cover-front img')!.dispatchEvent(new Event('error')));
    expect(container.textContent).toContain('Showing the album cover');
    expect(container.querySelector('.cover-front img')?.getAttribute('src')).toBe(album.artworkUrl);
  });
  it('returns from cassette packaging to the original CD cover without playing or changing selection', async () => {
    mock.cassette.mockReturnValue(artwork);
    await render(); await click(button('TAPES')); await click(button('Spotify')); await click(container.querySelector('.spine'));
    expect(container.querySelector('.cassette-album')).toBeTruthy();
    await click(container.querySelector('.footer-format'));
    expect(container.querySelector('.covers-focus')).toBeTruthy();
    await click(container.querySelector('.footer-format'));
    expect(container.querySelector('.spotify-album img')?.getAttribute('src')).toBe(album.artworkUrl);
    expect(mock.album).toHaveBeenCalledTimes(1); expect(mock.playTrack).not.toHaveBeenCalled(); expect(mock.control).not.toHaveBeenCalled();
  });
});
