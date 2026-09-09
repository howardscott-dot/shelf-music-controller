import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, featureApi, libraryApi, sourceApi, spotifyApi } from './api';
import { AlbumIntelligence } from './components/AlbumIntelligence';
import { NowPlaying } from './components/NowPlaying';
import { Shelf } from './components/Shelf';
import { SearchPanel } from './components/SearchPanel';
import { SourcePicker } from './components/SourcePicker';
import { SpotifyPanel } from './components/SpotifyPanel';
import { OutputPanel } from './components/OutputPanel';
import { ToolsPanel, type Environment } from './components/ToolsPanel';
import type { AlbumDetail, AlbumIntelligence as Intelligence, AlbumSummary, Crate, GuideResult, PlaybackState, Source, SourceStatus, SpineStyle, SourcedStory, Track, TrackIntelligence } from './types';
import { readSpineStyle, saveSpineStyle } from './spine-style';

export default function App() {
  const [source, setSource] = useState<Source>();
  const [spineStyle, setSpineStyle] = useState<SpineStyle>(readSpineStyle);
  useEffect(() => saveSpineStyle(spineStyle), [spineStyle]);
  const [status, setStatus] = useState<SourceStatus>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  async function refresh() {
    try { setStatus(await sourceApi.status()); setError(undefined); } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('spotify');
    if (result) {
      setNotice(result === 'connected' ? 'Spotify is connected. Choose your collection below.' : 'Spotify was not connected. Please try signing in again from the same setup browser.');
      window.history.replaceState(null, '', window.location.pathname);
    }
    void refresh();
  }, []);
  function sources() { setSource(undefined); void refresh(); }
  if (!source) return <SourcePicker status={status} error={error} notice={notice} onRefresh={refresh} onChoose={setSource} spineStyle={spineStyle} onSpineStyle={setSpineStyle} />;
  return <Library key={source} source={source} onSources={sources} spineStyle={spineStyle} onSpineStyle={setSpineStyle} />;
}

function Library({ source, onSources, spineStyle, onSpineStyle }: { source: Source; onSources: () => void; spineStyle: SpineStyle; onSpineStyle: (style: SpineStyle) => void }) {
  const api = useMemo(() => libraryApi(source), [source]);
  const isSpotify = source === 'spotify';
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [selected, setSelected] = useState<AlbumDetail>();
  const [loadingAlbumId, setLoadingAlbumId] = useState<string>();
  const selectionRequest = useRef(0);
  const [state, setState] = useState<PlaybackState>();
  const [error, setError] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);
  const [intelligence, setIntelligence] = useState<Intelligence>();
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [albumStory, setAlbumStory] = useState<SourcedStory>();
  const [albumStoryLoading, setAlbumStoryLoading] = useState(false);
  const [trackIntelligence, setTrackIntelligence] = useState<TrackIntelligence>();
  const [trackIntelligenceLoading, setTrackIntelligenceLoading] = useState(false);
  const lightMotion = useMemo(() => {
    const appleTablet = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const shorterSide = Math.min(window.screen.width, window.screen.height);
    return (appleTablet && shorterSide <= 768) || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2);
  }, []);
  const [guideResult, setGuideResult] = useState<GuideResult>();
  const [crates, setCrates] = useState<Crate[]>([]);
  const [activeCrate, setActiveCrate] = useState<string>();
  const [environment, setEnvironment] = useState<Environment>(() => {
    try { const value = localStorage.getItem('shelf.environment'); return value === 'amber' || value === 'midnight' || value === 'forest' ? value : 'neutral'; } catch { return 'neutral'; }
  });
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const controlLock = useRef(false);
  const [page, setPage] = useState(0);
  const [catalogue, setCatalogue] = useState<{ query: string; items: AlbumSummary[]; total: number; start: number; kind: 'search' | 'guide' }>();
  const [searching, setSearching] = useState(false);
  const catalogueRequest = useRef(0);
  const crate = crates.find((item) => item.id === activeCrate);
  const crateIds = new Set(crate?.albums.filter((album) => album.source === source).map((album) => album.albumId));
  const crateFiltered = crate ? albums.filter((album) => crateIds.has(album.id)) : albums;
  const filtered = query.trim() ? crateFiltered.filter((album) => `${album.artist} ${album.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : crateFiltered;
  const visible = catalogue?.items ?? (isSpotify ? filtered.slice(page * 20, (page + 1) * 20) : filtered);
  const total = catalogue?.total ?? filtered.length;
  const start = catalogue?.start ?? page * 20;
  const size = catalogue ? catalogue.kind === 'guide' ? 20 : 10 : 20;

  useEffect(() => { void featureApi.crates().then((value) => setCrates(value.items)).catch(() => undefined); }, []);
  useEffect(() => { try { localStorage.setItem('shelf.environment', environment); } catch { /* Appearance still works for this visit. */ } }, [environment]);

  useEffect(() => { selectionRequest.current += 1; setSelected(undefined); setLoadingAlbumId(undefined); }, [page, query, catalogue?.query, catalogue?.start]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.albums().then((value) => { if (active) { setAlbums(value.items); setError(undefined); } })
      .catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, reload]);
  useEffect(() => {
    let active = true;
    let timer: number;
    const poll = async () => {
      let delay = isSpotify ? 5_000 : 2_000;
      try {
        if (!document.hidden) { const value = await api.state(); if (active) setState(value); }
      } catch (e) {
        if (isSpotify && active) {
          setError((e as Error).message);
          delay = e instanceof ApiError && e.retryAfter ? e.retryAfter * 1000 : 30_000;
        }
      }
      if (active) timer = window.setTimeout(poll, delay);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, isSpotify]);

  function changeQuery(value: string) { setQuery(value); setCatalogue(undefined); setPage(0); catalogueRequest.current += 1; setSearching(false); }
  async function searchCatalogue(term = query, offset = 0) {
    if (!term.trim()) return;
    const request = ++catalogueRequest.current;
    setSearching(true); setError(undefined);
    try { const result = await spotifyApi.search(term, offset); if (request === catalogueRequest.current) { setCatalogue({ ...result, query: term, start: offset, kind: 'search' }); setSelected(undefined); setSearchOpen(false); } }
    catch (e) { if (request === catalogueRequest.current) setError((e as Error).message); }
    finally { if (request === catalogueRequest.current) setSearching(false); }
  }
  async function openAlbum(album: AlbumSummary) {
    const request = ++selectionRequest.current;
    // Open immediately from the summary already on the shelf. The full track
    // list replaces this optimistic view as soon as the media server replies.
    setSelected({ ...album, tracks: [], durationSeconds: 0 });
    setLoadingAlbumId(album.id); setError(undefined);
    try { const detail = await api.album(album.id); if (request === selectionRequest.current) setSelected(detail); }
    catch (e) { if (request === selectionRequest.current) { setSelected(undefined); setError((e as Error).message); } }
    finally { if (request === selectionRequest.current) setLoadingAlbumId(undefined); }
  }
  async function runGuide(prompt: string) {
    setSearching(true); setError(undefined);
    try {
      const result = await featureApi.guide(prompt, source); setGuideResult(result);
      setCatalogue({ query: prompt, items: result.items, total: result.items.length, start: 0, kind: 'guide' }); setSelected(undefined); setSearchOpen(false); setPage(0);
      if (result.shouldPlay && result.items[0]) { const detail = await api.album(result.items[0].id); setSelected(detail); if (detail.tracks[0]) { await startTrack(detail.tracks[0], detail); setState(await api.state()); } }
    } catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.status === 409 && isSpotify) setDevicesOpen(true); else if (!isSpotify && (e as Error).message.includes('Choose a network player')) setOutputsOpen(true); }
    finally { setSearching(false); }
  }
  function closeAlbum() { selectionRequest.current += 1; setSelected(undefined); setLoadingAlbumId(undefined); }
  async function startTrack(track: Track, album: AlbumDetail) {
    await api.playTrack(track.id, album.id);
    void featureApi.recordPlay(album, source).catch(() => undefined);
  }
  async function showIntelligence(album = selected) {
    let target = album;
    if (!target && state?.albumId) {
      try { target = await api.album(state.albumId); } catch (e) { setError((e as Error).message); return; }
    }
    if (!target) return;
    setIntelligenceOpen(true); setIntelligence(undefined); setAlbumStory(undefined); setTrackIntelligence(undefined); setIntelligenceLoading(true); setAlbumStoryLoading(true);
    void featureApi.albumStory(source, target.id).then((value) => setAlbumStory(value.story)).catch(() => setAlbumStory(undefined)).finally(() => setAlbumStoryLoading(false));
    try { setIntelligence(await featureApi.intelligence(source, target.id)); } catch (e) { setError((e as Error).message); setIntelligenceOpen(false); }
    finally { setIntelligenceLoading(false); }
  }
  async function showTrackIntelligence(track: Track) {
    const albumId = intelligence?.album.id; if (!albumId) return;
    setTrackIntelligence(undefined); setTrackIntelligenceLoading(true);
    try { setTrackIntelligence(await featureApi.trackIntelligence(source, albumId, track.id)); } catch (e) { setError((e as Error).message); }
    finally { setTrackIntelligenceLoading(false); }
  }
  async function chooseRelated(album: AlbumSummary) { await openAlbum(album); void showIntelligence({ ...album, tracks: [], durationSeconds: 0 }); }
  async function refreshCrates() { const value = await featureApi.crates(); setCrates(value.items); }
  async function createCrate(name: string) { try { await featureApi.createCrate(name); await refreshCrates(); } catch (e) { setError((e as Error).message); } }
  async function deleteCrate(id: string) { try { await featureApi.deleteCrate(id); if (activeCrate === id) setActiveCrate(undefined); await refreshCrates(); } catch (e) { setError((e as Error).message); } }
  async function toggleCrateAlbum(value: Crate) { if (!selected) return; try { const included = value.albums.some((album) => album.source === source && album.albumId === selected.id); if (included) await featureApi.removeFromCrate(value.id, source, selected.id); else await featureApi.addToCrate(value.id, selected, source); await refreshCrates(); } catch (e) { setError((e as Error).message); } }
  async function play(track: Track) {
    if (!selected || controlLock.current) return;
    controlLock.current = true; setBusy(true); setError(undefined);
    try { await startTrack(track, selected); setState(await api.state()); }
    catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.status === 409 && isSpotify) setDevicesOpen(true); else if (!isSpotify && (e as Error).message.includes('Choose a network player')) setOutputsOpen(true); }
    finally { controlLock.current = false; setBusy(false); }
  }
  async function control(action: string, body?: object) {
    if (controlLock.current) return;
    controlLock.current = true; setBusy(true); setError(undefined);
    try {
      if (isSpotify) {
        if (action === 'play' && selected?.tracks[0] && selected.id !== state?.albumId) await startTrack(selected.tracks[0], selected);
        else if (action === 'random') await api.control('shuffle', { enabled: !state?.shuffle });
        else await api.control(action, body);
      } else if (action === 'random') {
        let album = selected;
        for (let attempt = 0; !album?.tracks.length && albums.length && attempt < 8; attempt += 1) album = await api.album(albums[Math.floor(Math.random() * albums.length)].id);
        if (album?.tracks.length) { setSelected(album); await startTrack(album.tracks[Math.floor(Math.random() * album.tracks.length)], album); }
      } else await api.control(action, body);
      setState(await api.state());
    } catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.status === 409 && isSpotify) setDevicesOpen(true); else if (!isSpotify && (e as Error).message.includes('Choose a network player')) setOutputsOpen(true); }
    finally { controlLock.current = false; setBusy(false); }
  }

  return <main className={`${selected || loadingAlbumId ? 'album-open' : ''} ${isSpotify ? 'spotify-library' : ''} ${lightMotion ? 'light-motion' : ''}`} data-environment={environment}>
    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label="Dismiss error">×</button></div>}
    {!error && state?.queueWarning && <div className="error" role="status"><span>{state.queueWarning}</span></div>}
    <Shelf key={`${source}:${catalogue?.query ?? query}:${start}`} albums={visible} selected={selected} playback={state} loadingId={loadingAlbumId} onSelect={openAlbum} onClose={closeAlbum} onPlay={play} spineStyle={spineStyle} lightMotion={lightMotion} />
    {isSpotify && <nav className="spotify-library-bar" aria-label="Spotify collection navigation">
      <a href={selected?.externalUrl ?? 'https://open.spotify.com/collection/albums'} target="_blank" rel="noreferrer" className="spotify-attribution"><img src="/spotify-logo.svg" alt="Spotify" /><span>OPEN SPOTIFY ↗</span></a>
      <span className="collection-caption" title={selected ? `${selected.title} · ${selected.artist}` : undefined}>{selected ? `${selected.title} · ${selected.artist}` : catalogue ? `${catalogue.kind === 'guide' ? 'Guide' : 'Results'} for “${catalogue.query}”` : crate ? crate.name : 'Saved albums'}{total > 0 ? ` · ${start + 1}–${Math.min(start + size, total)} of ${total}` : ''}</span>
      <button disabled={start === 0 || searching || catalogue?.kind === 'guide'} aria-label="Previous albums" onClick={() => catalogue ? void searchCatalogue(catalogue.query, Math.max(0, start - size)) : setPage(page - 1)}>←</button>
      <button disabled={start + size >= total || searching || catalogue?.kind === 'guide'} aria-label="Next albums" onClick={() => catalogue ? void searchCatalogue(catalogue.query, start + size) : setPage(page + 1)}>→</button>
      {catalogue && <button onClick={() => changeQuery('')}>SAVED ALBUMS</button>}
      <button onClick={() => setDevicesOpen(true)}>DEVICES</button>
    </nav>}
    {!loading && !visible.length && <div className="no-results"><span>{query ? `NO ALBUMS MATCH “${query}”` : isSpotify ? 'YOUR SAVED ALBUMS WILL APPEAR HERE' : 'NO ALBUMS FOUND'}</span>
      {isSpotify && !query && <small>Save albums in Spotify, or search the catalogue.</small>}
      {query ? <button onClick={() => changeQuery('')}>CLEAR FILTER</button> : <button onClick={() => setReload(reload + 1)}>REFRESH COLLECTION</button>}
      {isSpotify && <button onClick={() => setSearchOpen(true)}>SEARCH SPOTIFY</button>}
    </div>}
    {loading && <div className="library-loading" role="status">Loading your collection…</div>}
    <NowPlaying state={state} source={source} selectionPending={isSpotify && Boolean(selected && selected.id !== state?.albumId)} busy={busy} onControl={control} onInfo={() => void showIntelligence()} infoAvailable={Boolean(selected || state?.albumId)} onSearch={() => setSearchOpen(true)} onTools={() => setToolsOpen(true)} onOutputs={() => isSpotify ? setDevicesOpen(true) : setOutputsOpen(true)} onSources={onSources} filterActive={Boolean(query || activeCrate || catalogue)} spineStyle={spineStyle} onSpineStyle={onSpineStyle} />
    {searchOpen && <SearchPanel query={query} onChange={changeQuery} onClose={() => setSearchOpen(false)} onSearchCatalogue={isSpotify ? () => void searchCatalogue() : undefined} onGuide={(value) => void runGuide(value)} onClearResults={catalogue || activeCrate ? () => { setCatalogue(undefined); setActiveCrate(undefined); setGuideResult(undefined); setQuery(''); setPage(0); } : undefined} guideResult={guideResult} searching={searching} />}
    {toolsOpen && <ToolsPanel source={source} selected={selected} crates={crates} activeCrate={activeCrate} environment={environment} onEnvironment={setEnvironment} onClose={() => setToolsOpen(false)} onCreateCrate={(name) => void createCrate(name)} onDeleteCrate={(id) => void deleteCrate(id)} onToggleAlbum={(value) => void toggleCrateAlbum(value)} onChooseCrate={(id) => { setActiveCrate(id); setCatalogue(undefined); setQuery(''); setPage(0); setSelected(undefined); }} />}
    {intelligenceOpen && <AlbumIntelligence data={intelligence} loading={intelligenceLoading} albumStory={albumStory} albumStoryLoading={albumStoryLoading} trackData={trackIntelligence} trackLoading={trackIntelligenceLoading} onTrack={(track) => void showTrackIntelligence(track)} onClose={() => setIntelligenceOpen(false)} onSelect={(album) => void chooseRelated(album)} />}
    {devicesOpen && <SpotifyPanel onClose={() => setDevicesOpen(false)} onDisconnect={onSources} />}
    {outputsOpen && <OutputPanel onClose={() => setOutputsOpen(false)} onChanged={() => { setState(undefined); setError(undefined); }} />}
  </main>;
}
