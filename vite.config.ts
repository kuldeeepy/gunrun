import { defineConfig } from 'vite';

// Two pages: the 2.5D game (home) and the original pixel version.
export default defineConfig({
  build: { rollupOptions: { input: { main: 'index.html', classic: 'classic.html' } } },
});
