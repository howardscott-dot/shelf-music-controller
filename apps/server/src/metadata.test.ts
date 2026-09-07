import { describe, expect, it } from 'vitest';
import { cleanAlbumMetadata } from './metadata.js';

describe('album display metadata cleanup', () => {
  it('extracts an artist from conventional unknown-artist names', () => {
    expect(cleanAlbumMetadata('Unknown artist', 'Type O Negative - Life Is Killing Me [2003](Limited Edition)'))
      .toEqual({ artist: 'Type O Negative', title: 'Life Is Killing Me' });
  });
  it('extracts dated quoted names', () => {
    expect(cleanAlbumMetadata('Unknown artist', "Rammstein 2019 'Rammstein'"))
      .toEqual({ artist: 'Rammstein', title: 'Rammstein' });
  });
  it('removes duplicate artist and technical mastering labels', () => {
    expect(cleanAlbumMetadata('Black Sabbath', 'Black Sabbath - Headless Cross (PBTHAL 24/96)'))
      .toEqual({ artist: 'Black Sabbath', title: 'Headless Cross' });
  });
  it('keeps meaningful edition names', () => {
    expect(cleanAlbumMetadata('Andrea Bocelli', 'Opera (Deluxe Version)').title).toBe('Opera (Deluxe Version)');
  });
});
