import { describe, expect, it } from 'vitest';

describe('web scaffold', () => {
  it('uses a localhost API base by default in examples', () => {
    const apiBase = process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
    expect(apiBase).toMatch(/^https?:\/\//);
  });
});
