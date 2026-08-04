import baseConfig from '@league-helper/config/eslint.config.mjs';

export default [
  ...baseConfig,
  {
    ignores: ['.nuxt/**', '.output/**', 'dist/**'],
  },
];
