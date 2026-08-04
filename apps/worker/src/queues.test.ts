import { describe, expect, it } from 'vitest';
import { QUEUE_NAME, getRedisUrl } from './config.js';

describe('worker config', () => {
  it('uses the default redis url when unset', () => {
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    expect(getRedisUrl()).toBe('redis://localhost:6379');
    if (previous === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previous;
    }
  });

  it('exposes a stable default queue name', () => {
    expect(QUEUE_NAME).toBe('league-helper-default');
  });
});
