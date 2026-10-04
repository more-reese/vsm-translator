import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    strictPort: true,
    // The renderer imports the built-in translator from electron/, which sits
    // outside the Vite root.
    fs: { allow: ['..'] },
  },
});
