import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AlbumDetail, AlbumSummary, Track } from '../types';
import { useCassetteArtwork, type CassetteArtwork } from '../cassette-art';
import { hashHue } from '../utils';

export function CassetteSpine({ album, left, loading, onSelect }: { album: AlbumSummary; left: number; loading: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = useState('');
  const [failed, setFailed] = useState('');
  const artwork = useCassetteArtwork(album, visible);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '0px 128px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const scan = artwork?.spineUrl;
  const ready = !!scan && loaded === scan && failed !== scan;
  return <button ref={ref} className={`spine tape-spine tape-paper-${hashHue(album.id) % 4} ${ready ? 'cassette-scan-spine' : ''} ${loading ? 'loading' : ''}`} style={{ left, '--hue': hashHue(album.id) } as CSSProperties} onClick={onSelect} aria-label={`${album.artist} — ${album.title}`} title={`${album.artist} — ${album.title}${ready ? ' · Original cassette spine' : ' · Text label; original spine scan not available'}`}>
    {scan && failed !== scan && <img className="cassette-spine-image" src={scan} alt="" draggable={false} onLoad={() => setLoaded(scan)} onError={() => setFailed(scan)} />}
    {!ready && <><span className="tape-insert" aria-hidden="true" /><span className="tape-format-mark" aria-hidden="true">TAPE</span><span className="spine-title">{album.title}</span><span className="spine-artist">{album.artist}</span></>}
  </button>;
}

export function CassetteCover({ album, artwork, left, size, onClose, onPlay }: { album: AlbumDetail; artwork: CassetteArtwork; left: number; size: number; onClose: () => void; onPlay: (track: Track) => void }) {
  const [flipped, setFlipped] = useState(false);
  const [backReady, setBackReady] = useState(false);
  const [backFailed, setBackFailed] = useState(false);
  const [frontFailed, setFrontFailed] = useState(false);
  const [frontReady, setFrontReady] = useState(false);
  return <article className={`expanded-album cassette-album ${flipped ? 'flipped' : ''}`} style={{ left, width: size }} onClick={onClose} aria-label={`${album.title} cassette sleeve. Tap to close.`}>
    <div className="cassette-image-area">
      {!frontReady && !frontFailed && <img className="cassette-loading-cover" src={album.artworkUrl} alt={`${album.title} album cover while the cassette scan loads`} draggable={false} />}
      <div className="cover-card">
        <div className="cover-face cover-front">{frontFailed ? <div className="cassette-scan-missing"><img src={album.artworkUrl} alt={`${album.title} album cover`} draggable={false} /><p>The cassette scan couldn’t load. Showing the album cover.</p></div> : <img src={artwork.frontUrl} alt={`${album.title} original cassette sleeve`} draggable={false} onLoad={() => setFrontReady(true)} onError={() => setFrontFailed(true)} />}</div>
        <div className="cover-face cover-back">{artwork.backUrl && !backFailed && <img src={artwork.backUrl} alt={`${album.title} original cassette back sleeve`} draggable={false} onLoad={() => setBackReady(true)} onError={() => { setBackFailed(true); setBackReady(false); setFlipped(false); }} />}</div>
      </div>
    </div>
    <div className="cassette-caption" onClick={(event) => event.stopPropagation()}>
      <a href={artwork.releaseUrl} target="_blank" rel="noreferrer" title={`View ${artwork.edition} at MusicBrainz / Cover Art Archive`}>CASSETTE SCAN <span>{artwork.edition} · Cover Art Archive ↗</span></a>
      {artwork.backUrl && !backFailed && <button disabled={!backReady} className="cassette-flip" aria-label={flipped ? `Show the front cassette cover of ${album.title}` : `Show the back cassette cover of ${album.title}`} onClick={() => setFlipped(!flipped)}>↻</button>}
      {album.source !== 'spotify' && <button className="cassette-play" disabled={!album.tracks.length} aria-label={`Play ${album.title}`} onClick={() => { if (album.tracks[0]) onPlay(album.tracks[0]); }}>▶</button>}
    </div>
  </article>;
}
