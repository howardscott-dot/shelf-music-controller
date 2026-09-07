import { useState } from 'react';
import type { GuideResult } from '../types';

const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const guideIdeas = ['Atmospheric from the 1990s', 'Something calm for late evening', 'Energetic electronic music', 'Surprise me with a record'];

export function SearchPanel({ query, onChange, onClose, onSearchCatalogue, onGuide, onClearResults, guideResult, searching }: { query: string; onChange: (value: string) => void; onClose: () => void; onSearchCatalogue?: () => void; onGuide: (value: string) => void; onClearResults?: () => void; guideResult?: GuideResult; searching?: boolean }) {
  const [mode, setMode] = useState<'find' | 'guide'>('find');
  const [prompt, setPrompt] = useState('');
  const value = mode === 'guide' ? prompt : query;
  const change = mode === 'guide' ? setPrompt : onChange;
  return <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search albums">
    <div className="search-panel">
      <div className="search-heading"><span>{mode === 'guide' ? 'ASK THE MUSIC GUIDE' : 'SEARCH THE COLLECTION'}</span><button onClick={onClose} aria-label="Close search">×</button></div>
      <div className="search-modes"><button aria-pressed={mode === 'find'} onClick={() => setMode('find')}>FIND</button><button aria-pressed={mode === 'guide'} onClick={() => setMode('guide')}>MUSIC GUIDE</button>{onClearResults && <button className="show-all" onClick={onClearResults}>SHOW ALL RECORDS</button>}</div>
      <div className="search-field"><span aria-hidden="true">⌕</span><input autoFocus inputMode="none" value={value} onChange={(e) => change(e.target.value)} placeholder={mode === 'guide' ? 'Describe what you want to hear' : 'Album or artist'} aria-label={mode === 'guide' ? 'Music guide request' : 'Album or artist'} /><button disabled={!value} onClick={() => change('')}>{mode === 'guide' ? 'CLEAR' : 'CLEAR FILTER'}</button></div>
      {mode === 'find' && onSearchCatalogue && <div className="catalogue-search"><span>Typing filters your saved albums.</span><button disabled={!query.trim() || searching} onClick={onSearchCatalogue}>{searching ? 'SEARCHING…' : 'SEARCH SPOTIFY CATALOGUE ↗'}</button></div>}
      {mode === 'guide' && <div className="guide-bar"><div className="guide-ideas">{guideIdeas.map((idea) => <button key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}</div><div className="guide-response"><span>{guideResult?.interpretation ?? 'Ask naturally. SHELF reads the era, mood, genre and artist clues in your request.'}</span><button className="ask-guide" disabled={prompt.trim().length < 2 || searching} onClick={() => onGuide(prompt)}>{searching ? 'LISTENING…' : 'ASK SHELF'}</button></div></div>}
      <div className="touch-keyboard">
        {rows.map((row) => <div className="key-row" key={row}>{[...row].map((key) => <button key={key} onClick={() => change(value + key.toLowerCase())}>{key}</button>)}</div>)}
        <div className="key-row key-actions"><button className="backspace" onClick={() => change(value.slice(0, -1))}>⌫</button><button className="space" onClick={() => change(value + ' ')}>SPACE</button><button className="done" onClick={mode === 'guide' && value.trim() ? () => onGuide(value) : onClose}>{mode === 'guide' ? 'ASK' : 'DONE'}</button></div>
      </div>
    </div>
  </div>;
}
