import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.nuxt/**', '**/.output/**'],
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
        strict: true,
        jsx: 'preserve',
      },
    },
  },
});
