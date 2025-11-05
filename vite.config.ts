import { defineConfig } from 'vite';

// Use repo name as base path on GitHub Pages (e.g., /tsla-ble-dash/)
const repo = process.env.GITHUB_REPOSITORY?.split('/')?.[1];
const base = repo ? `/${repo}/` : '/';

export default defineConfig({
  base,
  build: {
    sourcemap: true,
  },
});
