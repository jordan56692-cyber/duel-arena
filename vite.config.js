import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // This package ships its own pre-bundled, chunked code (including large
    // WASM-loading files it dynamically imports internally). Vite's own
    // dependency optimizer was silently dropping exports when it tried to
    // re-bundle it, so tell Vite to leave it alone and load it natively.
    exclude: ['@n1xx1/ocgcore-wasm'],
  },
  // If you later deploy this to GitHub Pages as a project site
  // (i.e. https://<username>.github.io/duel-arena/), uncomment
  // the line below and set it to match your repo name:
  // base: '/duel-arena/',
});