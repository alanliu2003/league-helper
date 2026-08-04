import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Nuxt Riot key isolation', () => {
  it('does not reference RIOT_API_KEY in web runtime config', () => {
    const nuxtConfig = readFileSync(join(__dirname, '../nuxt.config.ts'), 'utf8');
    expect(nuxtConfig).not.toMatch(/RIOT_API_KEY\s*:/);
    expect(nuxtConfig).not.toContain('NUXT_PUBLIC_RIOT');
  });

  it('does not import Riot server configuration modules', () => {
    const nuxtConfig = readFileSync(join(__dirname, '../nuxt.config.ts'), 'utf8');
    expect(nuxtConfig).not.toContain('integrations/riot');
    expect(nuxtConfig).not.toContain('riot.config');
  });
});
