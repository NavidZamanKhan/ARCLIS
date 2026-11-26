import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const frontend = 'http://127.0.0.1:5173';
const backend = 'http://127.0.0.1:8000';
const shutdown = { signal: 'SIGTERM', timeout: 5000 };

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL: frontend,
    actionTimeout: 12000,
    browserName: 'chromium',
    launchOptions: { chromiumSandbox: true },
    viewport: { width: 1440, height: 940 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run preview -- --port 5173 --strictPort',
      url: frontend,
      reuseExistingServer: false,
      gracefulShutdown: shutdown,
    },
    {
      command: 'python -m uvicorn --app-dir backend config.asgi:application --host 127.0.0.1 --port 8000 --no-proxy-headers',
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      url: backend + '/api/v1/health/',
      reuseExistingServer: false,
      gracefulShutdown: shutdown,
      env: {
        DJANGO_DEBUG: '1',
        DJANGO_ALLOWED_HOSTS: '127.0.0.1',
        DJANGO_FRONTEND_ORIGINS: frontend,
        DJANGO_SQLITE_PATH: ':memory:',
        ARCLIS_ENABLE_LOCAL_EXECUTION: '1',
        ARCLIS_ENABLE_LOCAL_ANALYSIS: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    },
  ],
});
