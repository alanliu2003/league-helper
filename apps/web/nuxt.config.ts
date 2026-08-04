import { PRODUCT_NAME } from '@league-helper/shared';

export default defineNuxtConfig({
  compatibilityDate: '2025-01-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  // Bind IPv4 explicitly — on Windows, default ::1-only listen can refuse browser connections.
  devServer: {
    host: '127.0.0.1',
    port: 3000,
  },
  runtimeConfig: {
    // Server-only keys can be added later. Never put RIOT_API_KEY here.
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3001',
      productName: PRODUCT_NAME,
    },
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  app: {
    head: {
      title: PRODUCT_NAME,
      meta: [
        {
          name: 'description',
          content: `${PRODUCT_NAME} — League of Legends analytics and coaching`,
        },
      ],
    },
  },
});
