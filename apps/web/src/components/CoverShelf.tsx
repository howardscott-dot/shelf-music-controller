import { useRef, useState, type TouchEvent } from 'react';
import type { AlbumDetail, AlbumSummary, PlaybackState } from '../types';

interface CoverShelfProps {
  albums: AlbumSummary[];
  selected?: AlbumDetail;
  playback?: PlaybackState;
  loadingId?: string;
  start: number;
  total: number;
  nextReady?: boolean;
  pagingBusy?: boolean;
  onSelect: (album: AlbumSummary) => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const initials = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase();

function CoverTileArtwork({ album, priority }: { album: AlbumSummary; priority: number }) {
  const [failed, setFailed] = useState(false);
  const url = album.thumbnailUrl || album.artworkUrl;
  if (!url || failed) return <span className="cover-placeholder">{initials(album.title)}</span>;
  return <img src={url} alt="" draggable={false} decoding="async" loading={priority < 5 ? 'eager' : 'lazy'} fetchPriority={priority < 2 ? 'high' : 'auto'} onError={() => setFailed(true)} />;
}

export function CoverShelf({ albums, selected, playback, loadingId, start, total, nextReady = true, pagingBusy = false, onSelect, onClose, onPrevious, onNext }: CoverShelfProps) {
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const active = Boolean(selected && playback?.albumId === selected.id && ['PLAYING', 'PAUSED_PLAYBACK', 'TRANSITIONING'].includes(playback.transport));
  const previousDisabled = start <= 0 || pagingBusy;
  const hasMore = start + albums.length < total;
  const nextDisabled = !hasMore || !nextReady || pagingBusy;

  function touchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (touch) gesture.current = { x: touch.clientX, y: touch.clientY, moved: false };
  }

  function touchMove(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    const x = touch.clientX - gesture.current.x;
    const y = touch.clientY - gesture.current.y;
    if (Math.abs(x) >= 56 && Math.abs(x) > Math.abs(y) * 1.15) gesture.current.moved = true;
  }

  function touchEnd(event: TouchEvent<HTMLElement>) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    const x = touch.clientX - gesture.current.x;
    const y = touch.clientY - gesture.current.y;
    const paged = Math.abs(x) >= 56 && Math.abs(x) > Math.abs(y) * 1.15;
    gesture.current.moved = paged;
    if (paged) {
      if (x < 0 && !nextDisabled) onNext();
      if (x > 0 && !previousDisabled) onPrevious();
    }
    // iOS may synthesise a click shortly after touchend. Keep the swipe guard
    // alive long enough that paging can never also open the touched cover.
    if (paged) window.setTimeout(() => { gesture.current.moved = false; }, 350);
  }

  if (selected) {
    const status = playback?.transport === 'TRANSITIONING' ? 'STARTING' : playback?.transport === 'PLAYING' ? 'PLAYING' : playback?.transport === 'PAUSED_PLAYBACK' ? 'PAUSED' : 'SELECTED';
    return <section className="covers-browser covers-focus-view" data-spine-style="covers" aria-label="Selected album cover">
      <article className={`covers-focus ${active ? 'is-active' : ''}`}>
        <div className="covers-focus-art">
          {selected.artworkUrl ? <img src={selected.artworkUrl} alt={`${selected.title} cover`} draggable={false} decoding="async" fetchPriority="high" /> : <span className="cover-placeholder">{initials(selected.title)}</span>}
          <div className="covers-focus-copy">
            <span className="covers-state"><i aria-hidden="true" />{active ? status : selected.tracks.length ? 'SELECTED · PLAY BELOW' : 'OPENING ALBUM'}</span>
            <strong>{active && playback?.title ? playback.title : selected.title}</strong>
            <small>{active ? `${selected.artist} · ${selected.title}` : [selected.artist, selected.year].filter(Boolean).join(' · ')}</small>
          </div>
          <button className="covers-focus-close" onClick={onClose} aria-label={`Close ${selected.title}`}>×</button>
        </div>
      </article>
    </section>;
  }

  return <section className="covers-browser" data-spine-style="covers" aria-label="Album cover browser" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}>
    <div className="covers-grid">
      {albums.map((album, index) => {
        const playing = playback?.albumId === album.id && playback.transport !== 'STOPPED' && playback.transport !== 'UNKNOWN';
        return <button key={album.id} className={`cover-tile ${loadingId === album.id ? 'loading' : ''} ${playing ? 'playing' : ''}`} onClick={() => { if (!gesture.current.moved) onSelect(album); }} aria-label={`${album.title} by ${album.artist}${playing ? ', now playing' : ''}`}>
          <span className="cover-tile-art">
            <CoverTileArtwork album={album} priority={index} />
            {playing && <span className="cover-playing-mark">PLAYING</span>}
          </span>
          <span className="cover-tile-copy"><strong>{album.title}</strong><small>{album.artist}</small></span>
        </button>;
      })}
    </div>
    <nav className="covers-pagination" aria-label="Album pages">
      <button disabled={previousDisabled} onClick={onPrevious} aria-label="Previous album page">←</button>
      <span>{total ? `${start + 1}–${Math.min(start + albums.length, total)} / ${total}${pagingBusy || (hasMore && !nextReady) ? ' · LOADING' : ''}` : '0 / 0'}</span>
      <button disabled={nextDisabled} onClick={onNext} aria-label="Next album page">→</button>
    </nav>
  </section>;
}
