import { describe, expect, it } from 'vitest';
import { staticCacheControl } from './app.js';

describe('installed app release caching', () => {
  it('always revalidates the app shell and build marker', () => {
    expect(staticCacheControl('/opt/shelf/apps/web/dist/index.html')).toContain('must-revalidate');
    expect(staticCacheControl('/opt/shelf/apps/web/dist/version.json')).toBe('no-store');
    expect(staticCacheControl('/opt/shelf/apps/web/dist/manifest.webmanifest')).toBe('no-cache');
  });

  it('keeps content-addressed bundles immutable', () => {
    expect(staticCacheControl('/opt/shelf/apps/web/dist/assets/index-AbC123.js')).toContain('immutable');
  });
});
