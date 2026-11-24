import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build        -> dist/ (多文件，需静态服务器)
// npm run build:single -> dist-single/index.html (单文件，双击即可离线运行)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, host: '127.0.0.1' },
}));
