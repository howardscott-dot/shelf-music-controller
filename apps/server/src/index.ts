import { config as loadDotEnv } from 'dotenv';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

loadDotEnv({ path: new URL('../../../.env', import.meta.url) });
const config = loadConfig();
const app = buildApp(config);
await app.listen({ port: config.PORT, host: config.HOST });
