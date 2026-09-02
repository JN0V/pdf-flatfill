import { defineConfig } from '@playwright/test';

// The app is static files: a minimal HTTP server is enough, and python3 is
// available everywhere these tests run (CI, workstation).
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8124',
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR', // the scenarios assert the French labels
  },
  webServer: {
    command: 'python3 -m http.server 8124 -d ../../web --bind 127.0.0.1',
    port: 8124,
    reuseExistingServer: true,
  },
});
