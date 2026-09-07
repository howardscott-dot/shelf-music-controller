import type { AlbumIntelligence as Intelligence, AlbumSummary } from '../types';

export function AlbumIntelligence({ data, loading, onClose, onSelect }: { data?: Intelligence; loading: boolean; onClose: () => void; onSelect: (album: AlbumSummary) => void }) {
  return <aside className="intelligence-drawer" role="dialog" aria-modal="true" aria-label="Album intelligence">
    <div className="drawer-heading"><span>ALBUM INTELLIGENCE</span><button onClick={onClose} aria-label="Close album intelligence">×</button></div>
    {loading && <div className="drawer-loading">Reading the record sleeve…</div>}
    {data && <div className="intelligence-content">
      <div className="intelligence-title"><img src={data.album.artworkUrl} alt="" /><div><small>{data.album.artist}</small><h2>{data.album.title}</h2></div></div>
      <section><h3>RELEASE</h3><p>{data.context}</p></section>
      <section><h3>CREDITS</h3><p>{data.credits.length ? data.credits.join(' · ') : 'No performer credits are present in the connected metadata.'}</p></section>
      <section><h3>LINER NOTES</h3><p>{data.linerNotes}</p></section>
      <section><h3>YOUR LISTENING</h3><p>{data.listening.plays ? `${data.listening.plays} ${data.listening.plays === 1 ? 'play' : 'plays'} through SHELF${data.listening.lastPlayedAt ? ` · last played ${new Date(data.listening.lastPlayedAt).toLocaleDateString()}` : ''}.` : 'Not yet played through SHELF.'}</p></section>
      <section><h3>RELATED ON THIS SHELF</h3><div className="related-albums">{data.related.length ? data.related.map((album) => <button key={album.id} onClick={() => onSelect(album)}><img src={album.artworkUrl} alt="" /><span>{album.title}<small>{album.artist}</small></span></button>) : <p>No close neighbours were found in the connected metadata.</p>}</div></section>
      <p className="metadata-note">{data.note}</p>
    </div>}
  </aside>;
}
