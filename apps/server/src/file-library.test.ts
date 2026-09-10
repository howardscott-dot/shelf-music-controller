import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileLibrary } from './file-library.js';
import sharp from 'sharp';

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
function silentWave() {
  const data = Buffer.alloc(8000); const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(8000, 28); header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40); return Buffer.concat([header, data]);
}
it('turns a mounted Artist/Album folder into a safe playable library with range-friendly URLs', async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-files-')); const albumDirectory = join(directory, 'Artist', 'Album'); await mkdir(albumDirectory, { recursive: true });
  await writeFile(join(albumDirectory, '01 - Track.wav'), silentWave()); await writeFile(join(albumDirectory, 'cover.jpg'), Buffer.from('image'));
  const library = new FileLibrary(directory, 'http://shelf.local:8787'); const page = await library.albums();
  expect(page.total).toBe(1); expect(page.items[0]).toMatchObject({ source: 'files', artist: 'Artist', title: 'Album' });
  const album = await library.album(page.items[0]!.id); expect(album.tracks[0]?.title).toBe('01 - Track');
  expect(library.streamUrl(album.tracks[0]!.id)).toMatch(/^http:\/\/shelf\.local:8787\/api\/files\/audio\//);
  expect((await library.artwork(album.id))?.data.toString()).toBe('image');
  expect(await library.artwork(album.id, 360)).toBeUndefined();
});

it('reopens a cached LAN library immediately and refreshes it explicitly', async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-files-cache-'));
  const firstAlbum = join(directory, 'Artist', 'First Album');
  const cache = join(directory, '.shelf-cache', 'library.json');
  await mkdir(firstAlbum, { recursive: true });
  await writeFile(join(firstAlbum, '01 - Track.wav'), silentWave());
  expect((await new FileLibrary(directory, 'http://shelf.local:8787', cache).albums()).total).toBe(1);

  const secondAlbum = join(directory, 'Artist', 'Second Album');
  await mkdir(secondAlbum, { recursive: true });
  await writeFile(join(secondAlbum, '01 - Track.wav'), silentWave());
  const reopened = new FileLibrary(directory, 'http://shelf.local:8787', cache);
  expect((await reopened.albums()).total).toBe(1);
  expect((await reopened.refresh()).albums).toBe(2);
});

it('serves a small cached browser thumbnail while preserving the full cover', async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-files-cover-')); const albumDirectory = join(directory, 'Artist', 'Album'); await mkdir(albumDirectory, { recursive: true });
  await writeFile(join(albumDirectory, '01 - Track.wav'), silentWave());
  await writeFile(join(albumDirectory, 'cover.png'), await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#876543' } }).png().toBuffer());
  const library = new FileLibrary(directory, 'http://shelf.local:8787'); const page = await library.albums();
  expect(page.items[0]?.thumbnailUrl).toContain('width=360');
  const preview = await library.artwork(page.items[0]!.id, 320);
  expect(preview?.type).toBe('image/jpeg');
  expect(await sharp(preview!.data).metadata()).toMatchObject({ width: 320, height: 320 });
  expect(await library.artwork(page.items[0]!.id, 320)).toBe(preview);
  expect((await sharp((await library.artwork(page.items[0]!.id))!.data).metadata()).format).toBe('png');
});
