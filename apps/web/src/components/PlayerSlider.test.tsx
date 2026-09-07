// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PlayerSlider } from './PlayerSlider';

it('commits one control request at the end of a drag, not for every movement', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); const commit = vi.fn();
  try {
    await act(async () => root.render(<PlayerSlider label="Volume" max={100} value={20} onCommit={commit} />));
    const input = container.querySelector('input')!;
    for (const value of [25, 30, 55]) await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(commit).toHaveBeenCalledExactlyOnceWith(55);
    await act(async () => input.dispatchEvent(new Event('focusout', { bubbles: true })));
    expect(commit).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
