import { useState } from 'react';
import type { AlbumDetail, Crate, Source } from '../types';

export type Environment = 'neutral' | 'amber' | 'midnight' | 'forest';
export function ToolsPanel({ source, selected, crates, activeCrate, environment, onEnvironment, onClose, onCreateCrate, onDeleteCrate, onToggleAlbum, onChooseCrate }: { source: Source; selected?: AlbumDetail; crates: Crate[]; activeCrate?: string; environment: Environment; onEnvironment: (value: Environment) => void; onClose: () => void; onCreateCrate: (name: string) => void; onDeleteCrate: (id: string) => void; onToggleAlbum: (crate: Crate) => void; onChooseCrate: (id?: string) => void }) {
  const [tab, setTab] = useState<'crates' | 'atmosphere' | 'api'>('crates');
  const [name, setName] = useState('');
  return <aside className="tools-drawer" role="dialog" aria-modal="true" aria-label="Shelf tools">
    <div className="drawer-heading"><span>SHELF TOOLS</span><button onClick={onClose} aria-label="Close shelf tools">×</button></div>
    <div className="drawer-tabs">{(['crates', 'atmosphere', 'api'] as const).map((value) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value.toUpperCase()}</button>)}</div>
    {tab === 'crates' && <div className="tools-content crates-panel">
      <p>Small personal shelves for records you want to keep together.</p>
      <button className="all-records" aria-pressed={!activeCrate} onClick={() => { onChooseCrate(); onClose(); }}>ALL RECORDS</button>
      <div className="crate-list">{crates.map((crate) => { const included = Boolean(selected && crate.albums.some((album) => album.source === source && album.albumId === selected.id)); return <div className="crate-row" key={crate.id}><button className="crate-open" aria-pressed={activeCrate === crate.id} onClick={() => { onChooseCrate(crate.id); onClose(); }}><strong>{crate.name}</strong><small>{crate.albums.length} {crate.albums.length === 1 ? 'record' : 'records'}</small></button>{selected && <button className="crate-add" onClick={() => onToggleAlbum(crate)} aria-label={`${included ? 'Remove' : 'Add'} ${selected.title} ${included ? 'from' : 'to'} ${crate.name}`}>{included ? '−' : '+'}</button>}<button className="crate-delete" onClick={() => onDeleteCrate(crate.id)} aria-label={`Delete ${crate.name}`}>×</button></div>; })}</div>
      <form className="crate-create" onSubmit={(event) => { event.preventDefault(); if (name.trim()) { onCreateCrate(name.trim()); setName(''); } }}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="New crate name" maxLength={60} aria-label="New crate name" /><button disabled={!name.trim()}>CREATE</button></form>
    </div>}
    {tab === 'atmosphere' && <div className="tools-content atmosphere-panel"><p>A restrained glow around the shelf. The cases and artwork remain unchanged.</p><div className="atmosphere-options">{(['neutral', 'amber', 'midnight', 'forest'] as const).map((value) => <button key={value} aria-pressed={environment === value} onClick={() => onEnvironment(value)}><i className={`atmosphere-swatch ${value}`} />{value.toUpperCase()}</button>)}</div></div>}
    {tab === 'api' && <div className="tools-content api-panel"><p>Home Assistant, Apple Shortcuts and trusted local agents can control SHELF over your LAN.</p><code>{window.location.origin}/api/control/v1</code><a href="/api/control/v1/openapi.json" target="_blank" rel="noreferrer">OPEN API DESCRIPTION ↗</a><small>This interface is intended for your trusted home network.</small></div>}
  </aside>;
}
