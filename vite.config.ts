import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        physicsV2: 'physics-v2.html'
      }
    }
  }
});
