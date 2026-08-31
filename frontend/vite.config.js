import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: Vite (:5173) repassa /api e /login.html para o backend Express (:3000),
// preservando o cookie de sessão (mesmo host localhost → cookie é enviado).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api':        { target: 'http://localhost:3000', changeOrigin: false },
      '/login.html': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
