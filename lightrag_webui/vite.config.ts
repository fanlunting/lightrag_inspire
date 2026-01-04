import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { webuiPrefix } from './src/lib/constants'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite does NOT automatically expose `.env.*` values on `process.env` in config
  // unless you explicitly load them. We need these to build the dev proxy table.
  const env = loadEnv(mode, __dirname, '')

  const apiProxyEnabled = env.VITE_API_PROXY === 'true'
  const apiEndpoints = env.VITE_API_ENDPOINTS
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:9621'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    // base: import.meta.env.VITE_BASE_URL || '/webui/',
    base: webuiPrefix,
    build: {
      outDir: path.resolve(__dirname, '../lightrag/api/webui'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 3800,
      rollupOptions: {
        // Let Vite handle chunking automatically to avoid circular dependency issues
        output: {
          // Ensure consistent chunk naming format
          chunkFileNames: 'assets/[name]-[hash].js',
          // Entry file naming format
          entryFileNames: 'assets/[name]-[hash].js',
          // Asset file naming format
          assetFileNames: 'assets/[name]-[hash].[ext]'
        }
      }
    },
    server: {
      proxy:
        apiProxyEnabled && apiEndpoints
          ? Object.fromEntries(
              apiEndpoints.split(',').map((endpoint) => [
                endpoint,
                {
                  target: backendUrl,
                  changeOrigin: true,
                  rewrite:
                    endpoint === '/api'
                      ? (path) => path.replace(/^\/api/, '')
                      : endpoint === '/docs' ||
                          endpoint === '/redoc' ||
                          endpoint === '/openapi.json' ||
                          endpoint === '/static'
                        ? (path) => path
                        : undefined
                }
              ])
            )
          : {}
    }
  }
})