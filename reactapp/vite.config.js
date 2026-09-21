import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

function resolveDevApiTarget(env) {
  const explicitTarget = env.VITE_DEV_API_TARGET?.trim();
  if (explicitTarget) return explicitTarget.replace(/\/+$/, '');

  const configuredApiUrl = env.VITE_API_URL?.trim();
  if (configuredApiUrl) {
    try {
      return new URL(configuredApiUrl).origin;
    } catch {
      // Keep the local default below for an invalid optional override.
    }
  }

  return 'http://127.0.0.1:5000';
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: resolveDevApiTarget(env),
          changeOrigin: false,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
              return 'vendor';
            }
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
              return 'charts';
            }
            if (id.includes('node_modules/framer-motion')) {
              return 'animation';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons';
            }
            if (id.includes('node_modules/html2canvas')) {
              return 'html2canvas';
            }
          }
        }
      }
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,jsx}'],
      exclude: ['e2e/**', 'node_modules/**'],
      setupFiles: ['./src/test/setup.js'],
    }
  };
})
