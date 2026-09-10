// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlbumDetail, PlaybackState, SpineStyle } from '../types';
import { PlayingMedia } from './PlayingMedia';

const album: AlbumDetail = {
  id: 'album', title: 'The Turning World', artist: 'Signal Fires', genres: [], artworkUrl: '/cover.jpg', backArtworkUrl: '', spineUrl: '', durationSeconds: 240,
  tracks: [{ id: 'track', title: 'Slow Motion', artist: 'Signal Fires', album: 'The Turning World', index: 1, disc: 1, durationSeconds: 240 }]
};
const base: PlaybackState = { transport: 'PLAYING', albumId: album.id, trackId: 'track', title: 'Slow Motion', artist: album.artist, album: album.title, artworkUrl: album.artworkUrl, durationSeconds: 240, positionSeconds: 60, volume: 45, muted: false };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(media: Exclude<SpineStyle, 'covers'>, playback: PlaybackState = base, onClose = vi.fn()) { await act(async () => root.render(<PlayingMedia album={album} playback={playback} media={media} left={100} size={400} onClose={onClose} />)); return onClose; }

describe('active media player', () => {
  it('turns the playing album into a full-height transparent CD player', async () => {
    const close = await render('cd');
    expect(container.querySelector('.cd-media-player.is-playing')).toBeTruthy();
    expect(container.querySelector('.cd-disc img')?.getAttribute('src')).toBe(album.artworkUrl);
    expect((container.querySelector('.cd-disc') as HTMLElement).style.animationPlayState).toBe('running');
    expect(container.textContent).toContain('Slow Motion');
    await act(async () => (container.querySelector('.player-close') as HTMLElement).click());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves the CD mounted but freezes it when playback is paused', async () => {
    await render('cd', { ...base, transport: 'PAUSED_PLAYBACK' });
    expect(container.querySelector('.cd-media-player.is-paused')).toBeTruthy();
    expect((container.querySelector('.cd-disc') as HTMLElement).style.animationPlayState).toBe('paused');
    expect(container.textContent).toContain('PAUSED');
  });

  it('keeps both real hubs on stable timelines across playback polling', async () => {
    await render('tape', { ...base, positionSeconds: 24 });
    const leftHub = container.querySelector('.hub-left i');
    const rightHub = container.querySelector('.hub-right i');
    await render('tape', { ...base, positionSeconds: 216 });
    expect(container.querySelector('.hub-left i')).toBe(leftHub);
    expect(container.querySelector('.hub-right i')).toBe(rightHub);
    expect(container.querySelector('.tape-media-player.is-playing')).toBeTruthy();
    expect(container.querySelector('.cassette-skin')?.getAttribute('src')).toBe('/cassettes/transparent-transport.webp');
    expect(container.querySelector('.cassette-hand-label strong')?.textContent).toBe(album.title);
    expect(container.querySelector('.cassette-hand-label small')?.textContent).toBe(album.artist);
    expect(container.querySelectorAll('.photographic-hub')).toHaveLength(2);
    expect(container.querySelector('.cassette-reel')).toBeNull();
    expect(container.querySelector('.tape-pack-shadow')).toBeNull();
  });

  it('keeps one cassette for an album but chooses another on the next player mount', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.1);
    await act(async () => root.render(<PlayingMedia key="first" album={album} playback={base} media="tape" left={100} size={400} onClose={vi.fn()} />));
    const first = container.querySelector('.playing-cassette')?.getAttribute('data-tape-skin');
    await act(async () => root.render(<PlayingMedia key="second" album={{ ...album, id: 'album-two' }} playback={{ ...base, albumId: 'album-two' }} media="tape" left={100} size={400} onClose={vi.fn()} />));
    const second = container.querySelector('.playing-cassette')?.getAttribute('data-tape-skin');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('briefly reverses the reel animation after a backward seek', async () => {
    await render('tape', { ...base, positionSeconds: 120 });
    await render('tape', { ...base, positionSeconds: 40 });
    expect(container.querySelector('.tape-media-player.is-rewinding')).toBeTruthy();
    expect((container.querySelector('.hub-left i') as HTMLElement).style.animationDirection).toBe('reverse');
  });
});
