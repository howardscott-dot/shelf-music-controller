import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AlbumDetail, AlbumSummary, PlaybackState, SpineStyle, Track } from '../types';
import { hashHue, versionedArtwork } from '../utils';
import { CassetteCover, CassetteSpine } from './Cassette';
import { useCassetteArtwork } from '../cassette-art';
import { PlayingMedia } from './PlayingMedia';

export function Shelf({ albums, selected, playback, loadingId, onSelect, onClose, onPlay, spineStyle = 'cd' }: { albums: AlbumSummary[]; selected?: AlbumDetail; playback?: PlaybackState; loadingId?: string; onSelect: (album: AlbumSummary) => void; onClose: () => void; onPlay: (track: Track) => void; spineStyle?: SpineStyle }) {
  const pitch = spineStyle === 'tape' ? 64 : 44;
  const previousPitch = useRef(pitch);
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const drag = useRef({ active: false, x: 0, y: 0, scrollLeft: 0 });
  const [range, setRange] = useState({ start: 0, end: 40 });
  const [openSize, setOpenSize] = useState(390);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [flippedAlbumId, setFlippedAlbumId] = useState<string>();
  const [backReadyFor, setBackReadyFor] = useState<string>();
  const [backUnavailableFor, setBackUnavailableFor] = useState<string>();
  const cassetteArtwork = useCassetteArtwork(selected, spineStyle === 'tape');
  const selectedIsActive = Boolean(selected && playback && playback.albumId === selected.id && (playback.transport === 'PLAYING' || playback.transport === 'PAUSED_PLAYBACK' || playback.transport === 'TRANSITIONING'));
  const selectedIndex = useMemo(() => selected ? albums.findIndex((a) => a.id === selected.id) : -1, [albums, selected]);
  const extra = selectedIndex >= 0 ? openSize - pitch : 0;
  const edgeInset = selectedIndex >= 0 ? Math.max(0, (viewportWidth - openSize) / 2) : 0;
  const leftFor = useCallback((index: number) => edgeInset + index * pitch + (selectedIndex >= 0 && index > selectedIndex ? extra : 0), [edgeInset, extra, pitch, selectedIndex]);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const logical = Math.max(0, el.scrollLeft - edgeInset - (selectedIndex >= 0 && el.scrollLeft > leftFor(selectedIndex) ? extra : 0));
    setRange({ start: Math.max(0, Math.floor(logical / pitch) - 10), end: Math.min(albums.length, Math.ceil((logical + el.clientWidth) / pitch) + 10) });
  }, [albums.length, edgeInset, extra, leftFor, pitch, selectedIndex]);
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
  useEffect(() => {
    const el = ref.current;
    if (!el || selectedIndex < 0) return;
    const frame = requestAnimationFrame(() => el.scrollTo({ left: Math.max(0, leftFor(selectedIndex) - (el.clientWidth - openSize) / 2), behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [leftFor, openSize, selected?.id, selectedIndex]);

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
            if (album.source === 'spotify') return <button key={album.id} className="expanded-album spotify-album" style={{ left: leftFor(index), width: openSize }} onClick={() => { if (!moved.current) onClose(); }} aria-label={`${selected.title} by ${selected.artist}. Close album cover.`}>
              {selected.artworkUrl ? <img src={selected.artworkUrl} alt={`${selected.title} cover`} draggable={false} /> : <span>{selected.title}<br />{selected.artist}</span>}
            </button>;
            const flipped = flippedAlbumId === selected.id;
            const backReady = Boolean(selected.backArtworkUrl) && backReadyFor === selected.id;
            const backUnavailable = !selected.backArtworkUrl || backUnavailableFor === selected.id;
            return <article key={album.id} className={`expanded-album ${flipped ? 'flipped' : ''}`} style={{ left: leftFor(index), width: openSize }} onClick={() => { if (!moved.current) onClose(); }} aria-label={`${selected.title} by ${selected.artist}. Tap to close.`}>
            <div className="cover-card">
              <div className="cover-face cover-front"><img src={versionedArtwork(selected.artworkUrl, 5)} alt={`${selected.title} front cover`} draggable={false} /></div>
              <div className="cover-face cover-back">{!backUnavailable && <img src={versionedArtwork(selected.backArtworkUrl, 7)} alt={`${selected.title} back cover`} draggable={false} ref={(image) => { if (image?.complete && image.naturalWidth > 0 && backReadyFor !== selected.id) setBackReadyFor(selected.id); }} onLoad={() => { setBackReadyFor(selected.id); setBackUnavailableFor((id) => id === selected.id ? undefined : id); }} onError={() => { setBackReadyFor(undefined); setBackUnavailableFor(selected.id); setFlippedAlbumId(undefined); }} />}</div>
            </div>
            <button className={`cover-flip ${!backReady && !backUnavailable ? 'loading' : ''} ${backUnavailable ? 'unavailable' : ''}`} disabled={!backReady} aria-label={flipped ? `Show the front cover of ${selected.title}` : backUnavailable ? `Back cover unavailable for ${selected.title}` : `Show the back cover of ${selected.title}`} title={flipped ? 'Front cover' : backUnavailable ? 'No genuine back-cover scan found' : backReady ? 'Back cover' : 'Finding back cover'} onClick={(event) => { event.stopPropagation(); setFlippedAlbumId(flipped ? undefined : selected.id); }}>↻</button>
            <button className="cover-play" disabled={!selected.tracks.length} aria-label={`Play ${selected.title}`} onClick={(event) => { event.stopPropagation(); if (selected.tracks[0]) onPlay(selected.tracks[0]); }}>▶</button>
          </article>;
          }
          if (spineStyle === 'tape') return <CassetteSpine key={album.id} album={album} left={leftFor(index)} loading={loadingId === album.id} onSelect={() => { if (!moved.current) onSelect(album); }} />;
          return <button key={album.id} className={`spine ${album.source === 'spotify' ? 'spotify-spine' : ''} ${loadingId === album.id ? 'loading' : ''}`} style={{ left: leftFor(index), '--hue': hashHue(album.id), backgroundImage: album.source === 'spotify' ? undefined : `linear-gradient(90deg, rgba(0,0,0,.2), rgba(255,255,255,.08), rgba(0,0,0,.38)), url(${album.spineUrl})` } as React.CSSProperties} onClick={() => { if (!moved.current) onSelect(album); }} title={`${album.artist} — ${album.title}`} aria-label={`${album.artist} — ${album.title}`}>
            <span className="spine-title">{album.title}</span><span className="spine-artist">{album.artist}</span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
