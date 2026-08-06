import { describe, expect, it } from 'vitest';
import { championFreshnessBanner } from './champion-freshness';

describe('championFreshnessBanner', () => {
  it('returns null for CURRENT freshness', () => {
    expect(championFreshnessBanner('CURRENT')).toBeNull();
  });

  it('returns a subtle updating banner for RECALCULATION_PENDING', () => {
    const banner = championFreshnessBanner('RECALCULATION_PENDING');
    expect(banner?.tone).toBe('accent');
    expect(banner?.text.toLowerCase()).toContain('updating');
  });

  it('shows timestamp without claiming currentness for UNKNOWN', () => {
    const banner = championFreshnessBanner('UNKNOWN', {
      calculatedAt: '2024-06-01T12:00:00.000Z',
    });
    expect(banner?.tone).toBe('muted');
    expect(banner?.text.toLowerCase()).toContain('not claimed as current');
    expect(banner?.text).not.toContain('staleRelativeToMatches');
  });
});
