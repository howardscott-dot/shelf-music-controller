const UNKNOWN_ARTIST = /^(unknown artist|various artists?)$/i;

function tidy(value: string): string {
  return value.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
}

function stripTechnicalSuffixes(title: string): string {
  return title
    .replace(/\s*\[(?:japan|eu|us|uk)?\s*[a-z]{1,8}[\s-]*[\w.-]+(?:\s+[^\]]*)?\]\s*$/i, '')
    .replace(/\s*\((?:pbthal\s*)?\d{2}(?:-bit)?\s*\/\s*\d{2,3}(?:khz)?\)\s*$/i, '')
    .replace(/\s*\((?:hi-res\s*)?\d{2}-bit\s*\/\s*\d{2,3}khz\)\s*$/i, '')
    .replace(/\s*\(cd\s*(\d+)\)\s*$/i, ' · Disc $1')
    .trim();
}

export function cleanAlbumMetadata(rawArtist: string, rawTitle: string): { artist: string; title: string } {
  let artist = tidy(rawArtist);
  let title = tidy(rawTitle);

  if (UNKNOWN_ARTIST.test(artist)) {
    const conventional = title.match(/^(.+?)\s+-\s+(.+?)(?:\s+\[\d{4}\].*)?$/);
    const datedQuoted = title.match(/^(.+?)\s+(?:19|20)\d{2}\s+['“](.+?)['”]$/);
    const match = conventional ?? datedQuoted;
    if (match?.[1] && match[2]) {
      artist = tidy(match[1]);
      title = tidy(match[2]);
    }
  } else {
    const duplicatedArtist = new RegExp(`^${artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+-\\s+`, 'i');
    title = title.replace(duplicatedArtist, '');
  }

  title = title.replace(/^((?:19|20)\d{2})\s+-\s+/, '').trim();
  title = stripTechnicalSuffixes(title);
  return { artist, title };
}
