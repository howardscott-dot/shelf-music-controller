import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SpotifyClient, SpotifyError } from './spotify.js';

const idSchema = z.string().regex(/^[A-Za-z0-9]{22}$/);
const pagination = z.object({ start: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(50).default(50) });
const controls = z.object({ positionSeconds: z.number().min(0).max(86400).optional(), volume: z.number().min(0).max(100).optional(), muted: z.boolean().optional(), enabled: z.boolean().optional() });
const cookieName = 'shelf_spotify_auth';

export async function spotifyRoutes(app: FastifyInstance, { spotify }: { spotify: SpotifyClient }) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== request.headers.host)) {
        return reply.code(403).send({ error: 'Spotify controls must be used from SHELF on this server.' });
      }
    }
  });

  app.get('/status', async () => spotify.status());
  app.get('/connect', async (request, reply) => {
    const redirect = new URL(spotify.redirectUri);
    // Start and finish on one origin so the HttpOnly state cookie binds sign-in
    // to the initiating browser. Loopback setup can use a one-time SSH tunnel.
    if (request.headers.host !== redirect.host) throw new SpotifyError('Open SHELF at the configured Spotify connection address to sign in. A loopback address needs a local connection or SSH tunnel to this server.', 409);
    const authorization = spotify.beginAuthorization();
    reply.header('Set-Cookie', `${cookieName}=${authorization.browser}; HttpOnly; SameSite=Lax; Path=/api/spotify; Max-Age=600${redirect.protocol === 'https:' ? '; Secure' : ''}`);
    return reply.redirect(authorization.url);
  });
  app.get('/callback', { logLevel: 'silent' }, async (request, reply) => {
    const query = z.object({ state: z.string().max(128).default(''), code: z.string().max(4096).optional(), error: z.string().max(256).optional() }).parse(request.query);
    const cookie = request.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
    reply.header('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/spotify; Max-Age=0${spotify.redirectUri.startsWith('https:') ? '; Secure' : ''}`);
    try {
      await spotify.finishAuthorization(query.state, cookie, query.code, query.error);
      return reply.redirect('/?spotify=connected');
    } catch {
      return reply.redirect('/?spotify=connection-failed');
    }
  });
  app.post('/disconnect', async () => { await spotify.disconnect(); return { ok: true }; });
  app.get('/albums', async (request) => { const { start, limit } = pagination.parse(request.query); return spotify.albums(start, limit); });
  app.get('/albums/:id', async (request) => spotify.album(idSchema.parse((request.params as { id: string }).id)));
  app.get('/search', async (request) => {
    const { q, start } = z.object({ q: z.string().trim().min(1).max(200), start: z.coerce.number().int().min(0).max(990).default(0) }).parse(request.query);
    return spotify.search(q, start);
  });
  app.get('/devices', async () => spotify.devices());
  app.post('/devices', async (request) => {
    const { id } = z.object({ id: z.string().min(1).max(256) }).parse(request.body);
    await spotify.selectDevice(id); return { ok: true };
  });
  app.get('/playback', async () => spotify.state());
  app.post('/playback/track/:id', async (request) => {
    const trackId = idSchema.parse((request.params as { id: string }).id);
    const { albumId } = z.object({ albumId: idSchema }).parse(request.body);
    await spotify.playTrack(trackId, albumId); return { ok: true };
  });
  app.post('/playback/:action', async (request) => {
    const action = z.enum(['play', 'pause', 'next', 'previous', 'seek', 'volume', 'mute', 'shuffle']).parse((request.params as { action: string }).action);
    await spotify.control(action, controls.parse(request.body ?? {})); return { ok: true };
  });
}
