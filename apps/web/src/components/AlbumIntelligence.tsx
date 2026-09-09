import { useEffect, useState } from 'react';
import type { AlbumIntelligence as Intelligence, AlbumSummary, SourcedStory, Track, TrackIntelligence } from '../types';
import { time } from '../utils';

export function AlbumIntelligence({ data, loading, albumStory, albumStoryLoading, trackData, trackLoading, onTrack, onClose, onSelect }: { data?: Intelligence; loading: boolean; albumStory?: SourcedStory; albumStoryLoading: boolean; trackData?: TrackIntelligence; trackLoading: boolean; onTrack: (track: Track) => void; onClose: () => void; onSelect: (album: AlbumSummary) => void }) {
  const [view, setView] = useState<'album' | 'songs'>('album');
  useEffect(() => { if (trackData) setView('songs'); }, [trackData]);
  return <aside className="intelligence-drawer" role="dialog" aria-modal="true" aria-label="Album intelligence">
    <div className="drawer-heading"><span>ALBUM INTELLIGENCE</span><button onClick={onClose} aria-label="Close album intelligence">×</button></div>
    <nav className="intelligence-tabs" aria-label="Information view"><button aria-pressed={view === 'album'} onClick={() => setView('album')}>ALBUM</button><button aria-pressed={view === 'songs'} onClick={() => setView('songs')}>SONGS &amp; LYRICS</button></nav>
    {loading && <div className="drawer-loading">Reading the record sleeve…</div>}
    {data && view === 'album' && <div className="intelligence-content">
      <div className="intelligence-title"><img src={data.album.artworkUrl} alt="" /><div><small>{data.album.artist}</small><h2>{data.album.title}</h2></div></div>
      <section><h3>RELEASE</h3><p>{data.context}</p></section>
      <section><h3>THE STORY</h3>{albumStoryLoading ? <p className="intelligence-pending">Looking for a reliable published account…</p> : albumStory ? <><p>{albumStory.text}</p><a className="intelligence-source" href={albumStory.sourceUrl} target="_blank" rel="noreferrer">SOURCE · {albumStory.sourceName} ↗</a></> : <p>No reliably sourced album story was found. SHELF will not invent one.</p>}</section>
      <section><h3>CREDITS</h3><p>{data.credits.length ? data.credits.join(' · ') : 'No performer credits are present in the connected metadata.'}</p></section>
      <section><h3>LINER NOTES</h3><p>{data.linerNotes}</p></section>
      <section><h3>YOUR LISTENING</h3><p>{data.listening.plays ? `${data.listening.plays} ${data.listening.plays === 1 ? 'play' : 'plays'} through SHELF${data.listening.lastPlayedAt ? ` · last played ${new Date(data.listening.lastPlayedAt).toLocaleDateString()}` : ''}.` : 'Not yet played through SHELF.'}</p></section>
      <section><h3>RELATED ON THIS SHELF</h3><div className="related-albums">{data.related.length ? data.related.map((album) => <button key={album.id} onClick={() => onSelect(album)}><img src={album.artworkUrl} alt="" /><span>{album.title}<small>{album.artist}</small></span></button>) : <p>No close neighbours were found in the connected metadata.</p>}</div></section>
      <p className="metadata-note">{data.note}</p>
    </div>}
    {data && view === 'songs' && <div className="intelligence-content song-intelligence">
      <div className="intelligence-title"><img src={data.album.artworkUrl} alt="" /><div><small>SONGS ON</small><h2>{data.album.title}</h2></div></div>
      <div className="intelligence-track-list">{data.album.tracks.map((track) => <button key={track.id} aria-pressed={trackData?.track.id === track.id} onClick={() => onTrack(track)}><span>{track.index || '·'}</span><strong>{track.title}</strong><small>{time(track.durationSeconds)}</small></button>)}</div>
      {trackLoading && <div className="drawer-loading track-loading">Finding lyrics and a sourced song story…</div>}
      {trackData && !trackLoading && <div className="track-intelligence-result">
        <section><h3>THE STORY BEHIND “{trackData.track.title.toLocaleUpperCase()}”</h3>{trackData.story ? <><p>{trackData.story.text}</p><a className="intelligence-source" href={trackData.story.sourceUrl} target="_blank" rel="noreferrer">SOURCE · {trackData.story.sourceName} ↗</a></> : <p>No reliably sourced story was found for this song.</p>}</section>
        <section><h3>LYRICS</h3>{trackData.lyrics ? <><pre className="lyrics">{trackData.lyrics.plain}</pre>{trackData.lyrics.sourceUrl ? <a className="intelligence-source" href={trackData.lyrics.sourceUrl} target="_blank" rel="noreferrer">SOURCE · {trackData.lyrics.sourceName} ↗</a> : <span className="intelligence-source">SOURCE · {trackData.lyrics.sourceName}</span>}</> : <p>Lyrics are not available from your music library or the public lyrics service.</p>}</section>
        <p className="metadata-note">{trackData.note}</p>
      </div>}
    </div>}
  </aside>;
}
