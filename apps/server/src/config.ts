import { z } from 'zod';

const schema = z.object({
  JELLYFIN_URL: z.string().url(),
  JELLYFIN_API_KEY: z.string().min(1),
  JELLYFIN_USER_ID: z.string().min(1),
  WIIM_HOST: z.string().min(1),
  WIIM_PORT: z.coerce.number().int().positive().default(49152),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  SPOTIFY_CLIENT_ID: z.string().regex(/^[a-f0-9]{32}$/i).optional().or(z.literal('')),
  SPOTIFY_REDIRECT_URI: z.string().url().default('http://127.0.0.1:8787/api/spotify/callback').refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/api/spotify/callback'
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)));
  }, 'Spotify callback must use HTTPS or an explicit loopback IP, and /api/spotify/callback'),
  SHELF_DATA_DIR: z.string().default('.data')
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
