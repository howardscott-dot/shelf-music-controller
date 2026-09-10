import { useState } from 'react';
import type { Source, SourceStatus, SpineStyle } from '../types';

export function SourcePicker({ status, error, notice, onChoose, onRefresh, spineStyle, onSpineStyle }: { status?: SourceStatus; error?: string; notice?: string; onChoose: (source: Source) => void; onRefresh: () => void; spineStyle: SpineStyle; onSpineStyle: (style: SpineStyle) => void }) {
  const [setup, setSetup] = useState(false);
  const spotify = status?.spotify;
  return <main className="source-screen">
    <div className="source-content">
      <div className="source-wordmark">SHELF<span>•</span></div>
      <p className="source-eyebrow">YOUR MUSIC. YOUR WAY.</p>
      <h1>Where shall we listen?</h1>
      <p className="source-intro">Choose a collection. Settle into an album.</p>
      {notice && <p className="source-notice" role="status">{notice}</p>}
      <div className="source-options">
        <button className="source-option source-jellyfin" onClick={() => onChoose('jellyfin')}>
          <span className="source-number">01 / LOCAL LIBRARY</span><strong>Jellyfin</strong><span>Your collection, on your stereo.</span><span className="source-action">OPEN COLLECTION <span aria-hidden="true">↗</span></span>
        </button>
        <button className="source-option source-spotify" onClick={() => spotify?.connected ? onChoose('spotify') : setSetup(true)}>
          <span className="source-number">02 / STREAMING</span><strong>Spotify</strong><span>Saved favourites. New discoveries.</span><span className="source-action">{spotify?.connected ? 'OPEN SPOTIFY COLLECTION' : 'CONNECT SPOTIFY'} <span aria-hidden="true">↗</span></span>
        </button>
        <button className="source-option source-plex" disabled={!status?.plex.configured} onClick={() => onChoose('plex')} aria-label={status?.plex.configured ? 'Open Plex music' : 'Plex — configure on the SHELF server'}>
          <span className="source-number">03 / HOME SERVER</span><strong>Plex</strong><span>Your Plex music library, on the same shelf.</span><span className="source-action">{status?.plex.configured ? status.plex.connected === false ? 'SERVER UNAVAILABLE' : 'OPEN PLEX MUSIC' : 'SET UP ON SERVER'} <span aria-hidden="true">↗</span></span>
        </button>
        <button className="source-option source-files" disabled={!status?.files.configured} onClick={() => onChoose('files')} aria-label={status?.files.configured ? 'Open mounted music folder' : 'Music folders — configure on the SHELF server'}>
          <span className="source-number">04 / NAS OR FOLDER</span><strong>Music files</strong><span>Tagged albums from a mounted local or NAS folder.</span><span className="source-action">{status?.files.configured ? status.files.albums === undefined ? 'OPEN MUSIC FOLDER' : `OPEN ${status.files.albums} ALBUMS` : 'MOUNT & SET UP'} <span aria-hidden="true">↗</span></span>
        </button>
        <button className="source-option source-apple" disabled aria-label="Apple Music — coming soon, not connected">
          <span className="source-number">05 / STREAMING</span><strong>Apple Music</strong><span>A place for your next collection.</span><span className="source-action">COMING SOON</span>
        </button>
      </div>
      <div className="appearance-choice" role="group" aria-label="Shelf appearance"><span>SHELF STYLE</span><div className="appearance-segments"><button aria-pressed={spineStyle === 'cd'} onClick={() => onSpineStyle('cd')}>CD SPINES</button><button aria-pressed={spineStyle === 'tape'} onClick={() => onSpineStyle('tape')}>TAPES</button><button aria-pressed={spineStyle === 'covers'} onClick={() => onSpineStyle('covers')}>COVERS</button></div><small>Same collection. A faster album view for older screens.</small></div>
      {setup && <section className="source-setup" aria-label="Connect Spotify">
        <div><h2>{spotify?.configured ? 'Connect your Premium account' : 'One small setup, then just music.'}</h2>
          <p>{spotify?.configured ? 'Sign in once on the setup computer. Your connection stays on the SHELF server for every device on your LAN.' : 'Create a SHELF Web API app in Spotify’s developer dashboard, then add its Client ID to the SHELF server. No Client Secret or password is needed.'}</p>
          {!spotify?.configured && <p className="setup-redirect">Redirect URL: <code>http://127.0.0.1:8787/api/spotify/callback</code></p>}
          {spotify?.configured && <p className="setup-redirect">For the Proxmox installation, open this connection through the one-time SSH tunnel on your computer—not directly on the iPad.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="setup-actions">{spotify?.configured ? <a className="button-link" href={spotify.connectUrl}>CONNECT SPOTIFY ↗</a> : <a className="button-link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">DEVELOPER DASHBOARD ↗</a>}<button onClick={onRefresh}>CHECK CONNECTION</button></div>
      </section>}
      <p className="source-footnote">SHELF is your remote. The music goes straight to your speakers.<br />You can change collection any time from the footer.</p>
    </div>
  </main>;
}
