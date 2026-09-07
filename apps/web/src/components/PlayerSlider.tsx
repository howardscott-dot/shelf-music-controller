import { useEffect, useRef, useState } from 'react';

// Keep dragging local; send one network command at the end of a gesture.
export function PlayerSlider({ label, max, value, disabled, onCommit }: { label: string; max: number; value: number; disabled?: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<number>();
  const changed = useRef(false);
  useEffect(() => { if (!changed.current) setDraft(undefined); }, [value]);
  function commit(value: number) {
    if (!changed.current) return;
    changed.current = false; setDraft(undefined); onCommit(value);
  }
  return <input aria-label={label} type="range" min="0" max={max} value={draft ?? value} disabled={disabled}
    onChange={(event) => { changed.current = true; setDraft(Number(event.target.value)); }}
    onPointerUp={(event) => commit(Number(event.currentTarget.value))}
    onKeyUp={(event) => commit(Number(event.currentTarget.value))}
    onBlur={(event) => commit(Number(event.currentTarget.value))}
    onPointerCancel={() => { changed.current = false; setDraft(undefined); }} />;
}
