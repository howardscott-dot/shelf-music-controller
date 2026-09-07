import { useEffect, useRef, useState } from 'react';
import { spotifyApi } from '../api';
import type { SpotifyDevices } from '../types';

export function SpotifyPanel({ onClose, onDisconnect }: { onClose: () => void; onDisconnect: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [devices, setDevices] = useState<SpotifyDevices>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  async function refresh() {
    setBusy(true); setError(undefined);
    try { setDevices(await spotifyApi.devices()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { dialog.current?.showModal(); void refresh(); }, []);
  async function select(id: string) {
    setBusy(true); setError(undefined);
    try { await spotifyApi.device(id); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="spotify-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="spotify-devices-title">
    <div className="search-heading"><span id="spotify-devices-title">SPOTIFY CONNECT</span><button onClick={onClose} aria-label="Close Spotify devices">×</button></div>
    <h2>Where should the music play?</h2>
    <p>Open Spotify and choose your WiiM in its device menu if it isn’t listed here. Then refresh this list.</p>
    {error && <p className="panel-error" role="alert">{error}</p>}
    <div className="device-options">{devices?.devices.map((device) => <button key={device.id} disabled={busy || device.restricted} onClick={() => select(device.id)} aria-pressed={devices.selectedId === device.id}><span>{device.name}</span><small>{device.restricted ? 'Unavailable to API' : devices.selectedId === device.id ? 'Selected ✓' : device.active ? 'Currently playing here' : 'Select speaker'}</small></button>)}</div>
    {!busy && !devices?.devices.length && <p>No Spotify Connect devices found yet.</p>}
    <div className="panel-actions"><button onClick={refresh} disabled={busy}>{busy ? 'PLEASE WAIT…' : 'REFRESH DEVICES'}</button><button onClick={() => setConfirmDisconnect(true)} disabled={busy}>DISCONNECT ACCOUNT</button></div>
    {confirmDisconnect && <div className="disconnect-confirm"><p>Remove this Spotify connection for everyone using this SHELF server? Your saved Spotify library is not deleted.</p><button disabled={busy} onClick={async () => { setBusy(true); try { await spotifyApi.disconnect(); onDisconnect(); } catch (e) { setError((e as Error).message); setBusy(false); } }}>YES, DISCONNECT</button><button onClick={() => setConfirmDisconnect(false)}>KEEP CONNECTED</button></div>}
  </dialog>;
}
