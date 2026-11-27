import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'deployment') {
    const { VITE_ARCLIS_BACKEND_ORIGIN: origin } = loadEnv(mode, process.cwd(), 'VITE_');
    if (origin) {
      const backend = URL.parse(origin);
      if (!backend || backend.protocol !== 'https:' || backend.origin !== origin) {
        throw new Error('VITE_ARCLIS_BACKEND_ORIGIN must be an HTTPS origin without a path.');
      }
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1' },
    test: { environment: 'jsdom' },
  };
});
