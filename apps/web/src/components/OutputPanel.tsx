import { useEffect, useRef, useState } from 'react';
import { outputApi } from '../api';
import type { OutputDevices } from '../types';

export function OutputPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<OutputDevices>();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function discover() {
    setBusy(true); setError(undefined);
    try { setResult(await outputApi.discover()); } catch (value) { setError((value as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { dialog.current?.showModal(); void discover(); }, []);
  async function select(id: string) {
    setBusy(true); setError(undefined);
    try { await outputApi.select(id); onChanged(); onClose(); } catch (value) { setError((value as Error).message); } finally { setBusy(false); }
  }
  async function addManual() {
    if (!address.trim()) return;
    setBusy(true); setError(undefined);
    try { const found = await outputApi.manual(address.trim()); setResult(found); setAddress(''); } catch (value) { setError((value as Error).message); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="spotify-dialog output-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="outputs-title">
    <div className="search-heading"><span id="outputs-title">NETWORK PLAYERS</span><button onClick={onClose} aria-label="Close network players">×</button></div>
    <h2>Where should the music play?</h2>
    <p>SHELF finds standard UPnP and DLNA players on your network—including compatible equipment from WiiM, Naim, Cambridge Audio, Denon, Marantz, Yamaha and many others.</p>
    {error && <p className="panel-error" role="alert">{error}</p>}
    <div className="device-options">{result?.devices.map((device) => <button key={device.id} disabled={busy} onClick={() => select(device.id)} aria-pressed={device.selected}><span><strong>{device.name}</strong><small>{[device.manufacturer, device.model].filter(Boolean).join(' · ') || device.protocol}</small></span><small>{device.selected ? 'Selected ✓' : 'Select player'}</small></button>)}</div>
    {!busy && !result?.devices.length && <p>No compatible players answered this scan. Make sure the player is awake and on the same network.</p>}
    <div className="panel-actions"><button onClick={discover} disabled={busy}>{busy ? 'SEARCHING…' : 'SCAN AGAIN'}</button></div>
    <form className="manual-output" onSubmit={(event) => { event.preventDefault(); void addManual(); }}><label htmlFor="player-address">PLAYER NOT APPEARING?</label><div><input id="player-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="IP address or description URL" autoCapitalize="none" autoCorrect="off" /><button disabled={busy || !address.trim()}>ADD</button></div><small>Useful when SHELF and the player are on different VLANs. Enter the player’s IP address, or its UPnP description URL.</small></form>
  </dialog>;
}
