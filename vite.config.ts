import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  server: { host: '0.0.0.0' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(projectRoot, 'index.html'),
        physicsV2: resolve(projectRoot, 'physics-v2.html')
      }
    }
  }
});
