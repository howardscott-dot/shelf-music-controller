import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const buildId = new Date().toISOString().replace(/[-:.TZ]/g, '');

export default defineConfig({
  define: { __SHELF_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), {
    name: 'shelf-build-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) });
    }
  }],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8787' }
  },
  build: { target: 'es2020' }
});
