import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AlbumDetail, AlbumSummary, PlaybackState, SpineStyle, Track } from '../types';
import { hashHue, versionedArtwork } from '../utils';
import { CassetteCover, CassetteSpine } from './Cassette';
import { useCassetteArtwork } from '../cassette-art';
import { PlayingMedia } from './PlayingMedia';
import { CoverShelf } from './CoverShelf';

interface ShelfProps {
  albums: AlbumSummary[];
  selected?: AlbumDetail;
  playback?: PlaybackState;
  loadingId?: string;
  onSelect: (album: AlbumSummary) => void;
  onClose: () => void;
  onPlay: (track: Track) => void;
  spineStyle?: SpineStyle;
  lightMotion?: boolean;
  pageStart?: number;
  totalAlbums?: number;
  nextPageReady?: boolean;
  pageBusy?: boolean;
  onPreviousPage?: () => void;
  onNextPage?: () => void;
}

export const Shelf = memo(function Shelf(props: ShelfProps) {
  const { albums, selected, playback, loadingId, onSelect, onClose, onPlay, spineStyle = 'cd', lightMotion = false, pageStart = 0, totalAlbums = albums.length, nextPageReady = true, pageBusy = false, onPreviousPage = () => undefined, onNextPage = () => undefined } = props;
  if (spineStyle === 'covers') return <CoverShelf albums={albums} selected={selected} playback={playback} loadingId={loadingId} start={pageStart} total={totalAlbums} nextReady={nextPageReady} pagingBusy={pageBusy} onSelect={onSelect} onClose={onClose} onPrevious={onPreviousPage} onNext={onNextPage} />;
  return <PhysicalShelf albums={albums} selected={selected} playback={playback} loadingId={loadingId} onSelect={onSelect} onClose={onClose} onPlay={onPlay} spineStyle={spineStyle} lightMotion={lightMotion} />;
});

function PhysicalShelf({ albums, selected, playback, loadingId, onSelect, onClose, onPlay, spineStyle, lightMotion }: { albums: AlbumSummary[]; selected?: AlbumDetail; playback?: PlaybackState; loadingId?: string; onSelect: (album: AlbumSummary) => void; onClose: () => void; onPlay: (track: Track) => void; spineStyle: Exclude<SpineStyle, 'covers'>; lightMotion: boolean }) {
  const pitch = spineStyle === 'tape' ? 64 : 44;
  const previousPitch = useRef(pitch);
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const rangeFrame = useRef<number | undefined>(undefined);
  const previousScrollLeft = useRef(0);
  const drag = useRef({ active: false, x: 0, y: 0, scrollLeft: 0 });
  const [range, setRange] = useState({ start: 0, end: 24 });
  const [openSize, setOpenSize] = useState(390);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [flippedAlbumId, setFlippedAlbumId] = useState<string>();
  const [backReadyFor, setBackReadyFor] = useState<string>();
  const [backUnavailableFor, setBackUnavailableFor] = useState<string>();
  const [loadBackFor, setLoadBackFor] = useState<string>();
  const cassetteArtwork = useCassetteArtwork(selected, spineStyle === 'tape');
  const selectedIsActive = Boolean(selected && playback && playback.albumId === selected.id && (playback.transport === 'PLAYING' || playback.transport === 'PAUSED_PLAYBACK' || playback.transport === 'TRANSITIONING'));
  const selectedIndex = useMemo(() => selected ? albums.findIndex((a) => a.id === selected.id) : -1, [albums, selected]);
  const extra = selectedIndex >= 0 ? openSize - pitch : 0;
  const edgeInset = selectedIndex >= 0 ? Math.max(0, (viewportWidth - openSize) / 2) : 0;
  const leftFor = useCallback((index: number) => edgeInset + index * pitch + (selectedIndex >= 0 && index > selectedIndex ? extra : 0), [edgeInset, extra, pitch, selectedIndex]);
  const update = useCallback(() => {
    if (!albums.length) return;
    if (rangeFrame.current !== undefined) return;
    rangeFrame.current = requestAnimationFrame(() => {
      rangeFrame.current = undefined;
      const el = ref.current;
      if (!el) return;
      const logical = Math.max(0, el.scrollLeft - edgeInset - (selectedIndex >= 0 && el.scrollLeft > leftFor(selectedIndex) ? extra : 0));
      const visibleStart = Math.max(0, Math.floor(logical / pitch));
      const visibleEnd = Math.min(albums.length, Math.ceil((logical + el.clientWidth) / pitch));
      const viewportItems = Math.max(1, Math.ceil(el.clientWidth / pitch));
      const movingRight = el.scrollLeft >= previousScrollLeft.current;
      previousScrollLeft.current = el.scrollLeft;
      // iOS performs momentum scrolling on a separate compositor thread. Keep
      // roughly a viewport of real spines ready in the direction of travel and
      // move the React window only as it approaches the buffered edge.
      const nearBuffer = Math.ceil(viewportItems * (lightMotion ? (movingRight ? .5 : 1.25) : (movingRight ? .75 : 3)));
      const farBuffer = Math.ceil(viewportItems * (lightMotion ? (movingRight ? 1.25 : .5) : (movingRight ? 3 : .75)));
      const guard = Math.max(4, Math.ceil(viewportItems * .65));
      const next = { start: Math.max(0, visibleStart - nearBuffer), end: Math.min(albums.length, visibleEnd + farBuffer) };
      setRange((current) => {
        const safelyCovered = (current.start === 0 || visibleStart >= current.start + guard) && (current.end === albums.length || visibleEnd <= current.end - guard);
        if (safelyCovered || (current.start === next.start && current.end === next.end)) return current;
        return next;
      });
    });
  }, [albums.length, edgeInset, extra, leftFor, lightMotion, pitch, selectedIndex]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && previousPitch.current !== pitch && selectedIndex < 0) el.scrollLeft = el.scrollLeft / previousPitch.current * pitch;
    previousPitch.current = pitch;
    update();
  }, [pitch, selectedIndex, update]);
  useEffect(update, [update]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { setOpenSize(Math.max(260, el.clientHeight - 17)); setViewportWidth(el.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { update(); }, [openSize, selectedIndex, update]);
  useEffect(() => () => { if (rangeFrame.current !== undefined) cancelAnimationFrame(rangeFrame.current); }, []);
  useEffect(() => {
    setLoadBackFor(undefined);
    if (!selected?.backArtworkUrl) return;
    // The hidden back is expensive to find and decode on older iPads. Let the
    // front open and settle first, then prepare the optional flip side.
    const timer = window.setTimeout(() => setLoadBackFor(selected.id), 900);
    return () => window.clearTimeout(timer);
  }, [selected?.backArtworkUrl, selected?.id]);
  useEffect(() => {
    const el = ref.current;
    if (!el || selectedIndex < 0) return;
    const frame = requestAnimationFrame(() => el.scrollTo({ left: Math.max(0, leftFor(selectedIndex) - (el.clientWidth - openSize) / 2), behavior: lightMotion ? 'auto' : 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [leftFor, lightMotion, openSize, selected?.id, selectedIndex]);

  return <section className={`shelf-wrap ${spineStyle === 'tape' ? 'tape-shelf' : ''}`} data-spine-style={spineStyle} aria-label={spineStyle === 'tape' ? 'Tape album shelf' : 'CD album shelf'}>
    <div className="shelf" ref={ref} onScroll={update}
      onWheel={(e) => { const amount = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (amount) { e.preventDefault(); ref.current?.scrollBy({ left: amount }); } }}
      onPointerDown={(e) => { if (!ref.current || e.button !== 0) return; drag.current = { active: true, x: e.clientX, y: e.clientY, scrollLeft: ref.current.scrollLeft }; moved.current = false; }}
      onPointerMove={(e) => { if (!drag.current.active || !ref.current) return; const dx = e.clientX - drag.current.x; const dy = e.clientY - drag.current.y; if (Math.hypot(dx, dy) > 8) moved.current = true; if (e.pointerType === 'mouse' && moved.current) { ref.current.classList.add('dragging'); ref.current.scrollLeft = drag.current.scrollLeft - dx; } }}
      onPointerUp={() => { drag.current.active = false; ref.current?.classList.remove('dragging'); }} onPointerCancel={() => { drag.current.active = false; moved.current = true; ref.current?.classList.remove('dragging'); }}>
      <div className="shelf-track" style={{ width: albums.length * pitch + extra + edgeInset * 2 }}>
        {albums.slice(range.start, range.end).map((album, offset) => {
          const index = range.start + offset;
          if (selected?.id === album.id) {
            if (selectedIsActive && playback) return <PlayingMedia key={`playing-${spineStyle}-${album.id}`} album={selected} playback={playback} media={spineStyle} left={leftFor(index)} size={openSize} onClose={() => { if (!moved.current) onClose(); }} />;
            if (spineStyle === 'tape' && cassetteArtwork?.status === 'found' && cassetteArtwork.frontUrl) return <CassetteCover key={`cassette-${album.id}`} album={selected} artwork={cassetteArtwork} left={leftFor(index)} size={openSize} onClose={() => { if (!moved.current) onClose(); }} onPlay={onPlay} />;
            if (album.source === 'spotify') return <button key={album.id} className="expanded-album spotify-album" style={{ '--shelf-left': `${leftFor(index)}px`, width: openSize } as CSSProperties} onClick={() => { if (!moved.current) onClose(); }} aria-label={`${selected.title} by ${selected.artist}. Close album cover.`}>
              {selected.artworkUrl ? <img src={selected.artworkUrl} alt={`${selected.title} cover`} draggable={false} decoding="async" fetchPriority="high" /> : <span>{selected.title}<br />{selected.artist}</span>}
            </button>;
            const flipped = flippedAlbumId === selected.id;
            const backReady = Boolean(selected.backArtworkUrl) && backReadyFor === selected.id;
            const backUnavailable = !selected.backArtworkUrl || backUnavailableFor === selected.id;
            const shouldLoadBack = backReady || loadBackFor === selected.id;
            return <article key={album.id} className={`expanded-album ${flipped ? 'flipped' : ''}`} style={{ '--shelf-left': `${leftFor(index)}px`, width: openSize } as CSSProperties} onClick={() => { if (!moved.current) onClose(); }} aria-label={`${selected.title} by ${selected.artist}. Tap to close.`}>
            <div className="cover-card">
              <div className="cover-face cover-front"><img src={versionedArtwork(selected.artworkUrl, 5)} alt={`${selected.title} front cover`} draggable={false} decoding="async" fetchPriority="high" /></div>
              <div className="cover-face cover-back">{shouldLoadBack && !backUnavailable && <img src={versionedArtwork(selected.backArtworkUrl, 7)} alt={`${selected.title} back cover`} draggable={false} ref={(image) => { if (image?.complete && image.naturalWidth > 0 && backReadyFor !== selected.id) setBackReadyFor(selected.id); }} onLoad={() => { setBackReadyFor(selected.id); setBackUnavailableFor((id) => id === selected.id ? undefined : id); }} onError={() => { setBackReadyFor(undefined); setBackUnavailableFor(selected.id); setFlippedAlbumId(undefined); }} />}</div>
            </div>
            <button className={`cover-flip ${!backReady && !backUnavailable ? 'loading' : ''} ${backUnavailable ? 'unavailable' : ''}`} disabled={!backReady} aria-label={flipped ? `Show the front cover of ${selected.title}` : backUnavailable ? `Back cover unavailable for ${selected.title}` : `Show the back cover of ${selected.title}`} title={flipped ? 'Front cover' : backUnavailable ? 'No genuine back-cover scan found' : backReady ? 'Back cover' : 'Finding back cover'} onClick={(event) => { event.stopPropagation(); setFlippedAlbumId(flipped ? undefined : selected.id); }}>↻</button>
            <button className="cover-play" disabled={!selected.tracks.length} aria-label={`Play ${selected.title}`} onClick={(event) => { event.stopPropagation(); if (selected.tracks[0]) onPlay(selected.tracks[0]); }}>▶</button>
          </article>;
          }
          if (spineStyle === 'tape') return <CassetteSpine key={album.id} album={album} left={leftFor(index)} loading={loadingId === album.id} onSelect={() => { if (!moved.current) onSelect(album); }} />;
          return <button key={album.id} className={`spine ${album.source === 'spotify' ? 'spotify-spine' : ''} ${loadingId === album.id ? 'loading' : ''}`} style={{ '--shelf-left': `${leftFor(index)}px`, '--hue': hashHue(album.id), backgroundImage: album.source === 'spotify' ? undefined : `linear-gradient(90deg, rgba(0,0,0,.2), rgba(255,255,255,.08), rgba(0,0,0,.38)), url(${album.spineUrl})` } as CSSProperties} onPointerDown={() => { if (!lightMotion && album.artworkUrl) { const image = new Image(); image.src = album.source === 'spotify' ? album.artworkUrl : versionedArtwork(album.artworkUrl, 5); } }} onClick={() => { if (!moved.current) onSelect(album); }} title={`${album.artist} — ${album.title}`} aria-label={`${album.artist} — ${album.title}`}>
            <span className="spine-title">{album.title}</span><span className="spine-artist">{album.artist}</span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
