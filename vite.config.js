import { defineConfig } from 'vite';

// `base: './'` keeps asset URLs relative so the build works under any
// GitHub Pages project path (e.g. /raptor-hunt/).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
});
