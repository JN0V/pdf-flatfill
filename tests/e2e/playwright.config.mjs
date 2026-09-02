import { defineConfig } from '@playwright/test';

// L'appli est constituée de fichiers statiques : un serveur HTTP minimal
// suffit, et python3 est présent partout où ces tests tournent (CI, poste).
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8124',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'python3 -m http.server 8124 -d ../../web --bind 127.0.0.1',
    port: 8124,
    reuseExistingServer: true,
  },
});
