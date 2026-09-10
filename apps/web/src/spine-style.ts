import type { SpineStyle } from './types';

export const SPINE_STYLE_KEY = 'shelf.spine-style';
export const SPINE_STYLES: SpineStyle[] = ['cd', 'tape', 'covers'];

export function readSpineStyle(): SpineStyle {
  try {
    const stored = window.localStorage.getItem(SPINE_STYLE_KEY);
    if (stored === 'cd' || stored === 'tape' || stored === 'covers') return stored;
    if (stored !== null) return 'cd';
    const appleTablet = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const constrained = appleTablet && Math.min(window.screen.width, window.screen.height) <= 768;
    return constrained ? 'covers' : 'cd';
  }
  catch { return 'cd'; }
}

export function nextSpineStyle(style: SpineStyle): SpineStyle {
  return SPINE_STYLES[(SPINE_STYLES.indexOf(style) + 1) % SPINE_STYLES.length]!;
}

export function saveSpineStyle(style: SpineStyle) {
  // Private browsing/storage restrictions must never block the music UI.
  try { window.localStorage.setItem(SPINE_STYLE_KEY, style); } catch { /* This device will use the choice for this visit. */ }
}
