import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        acoustics3d: resolve(__dirname, 'app-3d-acoustics.html'),
        studio1950s: resolve(__dirname, 'app-1950s-studio.html'),
        emt140: resolve(__dirname, 'app-emt140-plate.html'),
        vintageSuite: resolve(__dirname, 'app-vintage-suite.html')
      }
    }
  }
});
