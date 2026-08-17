import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_MODEL } from './ai-runtime';

describe('DEFAULT_AI_MODEL', () => {
  it('is the shared product default for champion and player AI', () => {
    expect(DEFAULT_AI_MODEL).toBe('qwen2.5:14b');
  });
});
