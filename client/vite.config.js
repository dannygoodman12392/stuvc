import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
    // The API target is configurable so a second dev pair can run alongside the
    // first without either stealing the other's port. Defaults to the usual 3002.
    proxy: {
      '/api': process.env.API_PROXY || 'http://localhost:3002'
    }
  },
  build: {
    outDir: 'dist'
  }
});
