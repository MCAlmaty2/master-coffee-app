import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // base: './' — путь относительный, чтобы работало и на Vercel, и в подпапке
  base: './',
  server: {
    host: true, // позволяет открывать с телефона через локальную сеть
    port: 5173,
  },
});
