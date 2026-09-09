import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AlbumDetail, PlaybackState, SpineStyle } from '../types';

const TAPE_SKINS = [
  { id: 'cyan', accent: '#55ced9' },
  { id: 'amber', accent: '#d5a351' },
  { id: 'magenta', accent: '#c85f81' },
  { id: 'green', accent: '#7eb58d' },
  { id: 'ice', accent: '#9cc7da' },
  { id: 'gold', accent: '#c4ae79' }
] as const;

let previousTapeSkin = -1;

function chooseTapeSkin() {
  if (previousTapeSkin < 0) {
    previousTapeSkin = Math.floor(Math.random() * TAPE_SKINS.length);
    return TAPE_SKINS[previousTapeSkin];
  }
  const availableIndex = Math.floor(Math.random() * (TAPE_SKINS.length - 1));
  const index = availableIndex >= previousTapeSkin ? availableIndex + 1 : availableIndex;
  previousTapeSkin = index;
  return TAPE_SKINS[index];
}

export function PlayingMedia({ album, playback, media, left, size, onClose }: { album: AlbumDetail; playback: PlaybackState; media: SpineStyle; left: number; size: number; onClose: () => void }) {
  const moving = playback.transport === 'PLAYING';
  const previous = useRef({ trackId: playback.trackId, position: playback.positionSeconds });
  const rewindTimer = useRef<number | undefined>(undefined);
  const [rewinding, setRewinding] = useState(false);

  useEffect(() => {
    const sameTrack = previous.current.trackId === playback.trackId;
    if (sameTrack && playback.positionSeconds < previous.current.position - 1) {
      setRewinding(true);
      window.clearTimeout(rewindTimer.current);
      rewindTimer.current = window.setTimeout(() => setRewinding(false), 900);
    }
    previous.current = { trackId: playback.trackId, position: playback.positionSeconds };
    return () => window.clearTimeout(rewindTimer.current);
  }, [playback.positionSeconds, playback.trackId]);

  const visual = media === 'cd'
    ? <CdMechanism album={album} moving={moving} />
    : <TapeMechanism album={album} moving={moving} rewinding={rewinding} />;

  return <article
    className={`expanded-album active-media-player ${media}-media-player ${moving ? 'is-playing' : 'is-paused'} ${rewinding ? 'is-rewinding' : ''}`}
    style={{ '--shelf-left': `${left}px`, width: size } as CSSProperties}
    onClick={onClose}
    aria-label={`${album.title} by ${album.artist}. ${moving ? 'Playing' : 'Paused'} in the ${media === 'cd' ? 'CD' : 'cassette'} player. Tap to close.`}
  >
    {visual}
    <div className="media-readout">
      <span><i aria-hidden="true" />{moving ? 'PLAYING' : 'PAUSED'}</span>
      <strong>{playback.title ?? album.title}</strong>
      <small>{album.artist}</small>
    </div>
    <button className="player-close" aria-label={`Close ${media === 'cd' ? 'CD' : 'cassette'} player`} onClick={(event) => { event.stopPropagation(); onClose(); }}>×</button>
  </article>;
}

function CdMechanism({ album, moving }: { album: AlbumDetail; moving: boolean }) {
  return <div className="cd-player-shell" aria-hidden="true">
    <span className="player-screw screw-a" /><span className="player-screw screw-b" /><span className="player-screw screw-c" /><span className="player-screw screw-d" />
    <div className="cd-disc-stage">
      <div className="cd-disc" style={{ animationPlayState: moving ? 'running' : 'paused' }}>
        <img src={album.artworkUrl} alt="" draggable={false} />
        <span className="cd-iridescence" />
        <span className="cd-hub"><i /></span>
      </div>
      <span className="cd-laser-line" />
    </div>
    <span className="player-glass-shine" />
  </div>;
}

function TapeMechanism({ album, moving, rewinding }: { album: AlbumDetail; moving: boolean; rewinding: boolean }) {
  const [skin] = useState(chooseTapeSkin);
  const style = {
    '--tape-accent': skin.accent
  } as CSSProperties;

  return <div className="cassette-player-shell" style={style} aria-hidden="true">
    <span className="player-screw screw-a" /><span className="player-screw screw-b" /><span className="player-screw screw-c" /><span className="player-screw screw-d" />
    <div className="playing-cassette" data-tape-skin={skin.id}>
      <img className="cassette-skin" src="/cassettes/transparent-transport.webp" alt="" draggable={false} />
      <span className="cassette-shell-tint" />
      <span className="cassette-hand-label"><strong>{album.title}</strong><small>{album.artist}</small></span>
      <div className="cassette-window">
        <span className="photographic-hub hub-left"><i style={{ animationPlayState: moving ? 'running' : 'paused', animationDirection: rewinding ? 'reverse' : 'normal' }} /></span>
        <span className="photographic-hub hub-right"><i style={{ animationPlayState: moving ? 'running' : 'paused', animationDirection: rewinding ? 'reverse' : 'normal' }} /></span>
      </div>
      <span className="cassette-status-glow"><i /></span>
      <span className="cassette-reflection" />
    </div>
    <span className="player-glass-shine" />
  </div>;
}
