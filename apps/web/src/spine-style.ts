import type { SpineStyle } from './types';

export const SPINE_STYLE_KEY = 'shelf.spine-style';

export function readSpineStyle(): SpineStyle {
  try { return window.localStorage.getItem(SPINE_STYLE_KEY) === 'tape' ? 'tape' : 'cd'; }
  catch { return 'cd'; }
}

export function saveSpineStyle(style: SpineStyle) {
  // Private browsing/storage restrictions must never block the music UI.
  try { window.localStorage.setItem(SPINE_STYLE_KEY, style); } catch { /* This device will use the choice for this visit. */ }
}
