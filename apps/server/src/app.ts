import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import { JellyfinClient } from './jellyfin.js';
import { WiimClient } from './wiim.js';
import { SpotifyClient, SpotifyError } from './spotify.js';
import { spotifyRoutes } from './spotify-routes.js';
import { ZodError } from 'zod';
import { CassetteArchive, cassetteRoutes } from './cassettes.js';
import { JellyfinPlayback, jellyfinPlaybackRoutes } from './jellyfin-playback.js';
import { featureRoutes } from './features.js';

export function buildApp(config: Config) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL, serializers: { req: (request) => ({ method: request.method, url: request.url?.split('?')[0], hostname: request.hostname }) } } });
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  const jellyfin = new JellyfinClient(config.JELLYFIN_URL, config.JELLYFIN_API_KEY, config.JELLYFIN_USER_ID);
  const wiim = new WiimClient(config.WIIM_HOST, config.WIIM_PORT);
  const spotify = new SpotifyClient(config);
  const playback = new JellyfinPlayback(wiim, jellyfin, (albumId) => {
    const artwork = jellyfin.imageUrl(albumId, 720);
    artwork.searchParams.set('api_key', config.JELLYFIN_API_KEY);
    return artwork.toString();
  });
  // The UI is served here (or through Vite's same-origin proxy). No external
  // website needs permission to read or control the household music account.
  app.register(cors, { origin: false });
  app.register(spotifyRoutes, { prefix: '/api/spotify', spotify });
  app.register(cassetteRoutes, { prefix: '/api', archive: new CassetteArchive() });
  app.register(jellyfinPlaybackRoutes, { prefix: '/api', playback });
  app.register(featureRoutes, { prefix: '/api', directory: config.SHELF_DATA_DIR, jellyfin, spotify, playback });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/albums', async (request) => {
    const query = request.query as { start?: string; limit?: string };
    return jellyfin.albums(Number(query.start ?? 0), Math.min(200, Number(query.limit ?? 100)));
  });
  app.get('/api/albums/:id', async (request) => jellyfin.album((request.params as { id: string }).id));
  app.get('/api/artwork/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const query = request.query as { width?: string; side?: string };
    const width = Math.max(64, Math.min(1600, Number(query.width ?? 720)));
    const upstream = query.side === 'back' ? await jellyfin.packagingImage(id, 'Back', width) : await jellyfin.image(id, width);
    if (!upstream) return reply.code(404).send({ error: 'Packaging artwork unavailable' });
    if (!upstream.ok) return reply.code(upstream.status).send({ error: 'Artwork unavailable' });
    reply.header('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return reply.send(Buffer.from(await upstream.arrayBuffer()));
  });
  app.get('/api/spines/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const physicalSpine = await jellyfin.spine(id);
    if (physicalSpine) {
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=2592000, immutable');
      reply.header('X-Shelf-Spine-Source', 'cover-art-archive');
      return reply.send(physicalSpine);
    }
    // A square cover is cropped into a very tall spine in the browser. Supplying
    // a large source keeps that narrow crop crisp on Retina/iPad displays.
    const upstream = await jellyfin.image(id, 1000);
    if (!upstream.ok) return reply.code(upstream.status).send({ error: 'Spine source unavailable' });
    reply.header('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
    return reply.send(Buffer.from(await upstream.arrayBuffer()));
  });

  if (existsSync(webRoot)) {
    app.register(fastifyStatic, { root: webRoot, prefix: '/', cacheControl: true, maxAge: '1h' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SpotifyError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid request. Check the selected item and control value.' });
    app.log.error(error);
    const message = error instanceof Error ? error.message : 'Unexpected integration error';
    reply.code(message.includes('required') || message.includes('belong') ? 400 : 502).send({ error: message });
  });
  return app;
}
