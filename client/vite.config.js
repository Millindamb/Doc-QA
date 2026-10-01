import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to the Express server so the client can use relative URLs
// (the production nginx image does the same, see client/nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_DEV_PROXY || 'http://localhost:5000', changeOrigin: true } },
  },
});
