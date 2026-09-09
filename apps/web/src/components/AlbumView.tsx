import { useEffect, useState } from 'react';
import type { AlbumDetail, Track } from '../types';
import { time, versionedArtwork } from '../utils';

export function AlbumView({ album, loading, onClose, onPlay }: { album?: AlbumDetail; loading: boolean; onClose: () => void; onPlay: (track: Track) => void }) {
  const [backUnavailable, setBackUnavailable] = useState(false);
  useEffect(() => setBackUnavailable(false), [album?.id]);
  if (loading) return <section className="album-view loading">Opening album…</section>;
  if (!album) return null;
  return (
    <section className="album-view">
      <button className="close" onClick={onClose} aria-label="Close album">×</button>
      <div className="open-jewel-case" aria-label={`${album.title} open CD case`}>
        <div className="case-panel case-front"><img src={versionedArtwork(album.artworkUrl, 4)} alt={`${album.title} front cover`} /></div>
        <div className="case-hinge" aria-hidden="true" />
        <div className="case-panel case-back">
          {!backUnavailable && album.backArtworkUrl
            ? <img src={versionedArtwork(album.backArtworkUrl, 4)} alt={`${album.title} back cover`} onError={() => setBackUnavailable(true)} />
            : <div className="art-unavailable"><span>BACK ART</span><small>NOT ARCHIVED</small></div>}
        </div>
      </div>
      <div className="album-copy">
        <p className="eyebrow">{album.artist}</p><h1>{album.title}</h1>
        <p className="metadata">{[album.year, album.genres[0], `${album.tracks.length} tracks`, time(album.durationSeconds)].filter(Boolean).join(' · ')}</p>
        <button className="play-album" disabled={!album.tracks.length} onClick={() => album.tracks[0] && onPlay(album.tracks[0])}>▶ <span>{album.tracks.length ? 'PLAY ALBUM' : 'NO TRACKS INDEXED'}</span></button>
      </div>
      <div className="tracks">
        {!album.tracks.length && <p className="empty-tracks">Jellyfin lists this album, but no audio tracks are attached to it.</p>}
        {album.tracks.map((track) => <button key={track.id} className="track" onClick={() => onPlay(track)}><span>{track.index || '–'}</span><span>{track.title}</span><span>{time(track.durationSeconds)}</span></button>)}
      </div>
    </section>
  );
}
