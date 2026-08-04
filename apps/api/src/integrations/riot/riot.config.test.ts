import { describe, expect, it } from 'vitest';
import { ProviderNotConfiguredError, ValidationFailureError } from '@league-helper/shared';
import { isRiotProviderConfigured, loadRiotConfig, requireRiotApiKey } from './riot.config';

describe('Riot configuration', () => {
  it('defaults to mock mode and does not require a key', () => {
    const config = loadRiotConfig({});
    expect(config.providerMode).toBe('mock');
    expect(config.apiKey).toBeUndefined();
    expect(isRiotProviderConfigured(config)).toBe(true);
  });

  it('accepts real mode without a key at load time', () => {
    const config = loadRiotConfig({ RIOT_PROVIDER_MODE: 'real' });
    expect(config.providerMode).toBe('real');
    expect(isRiotProviderConfigured(config)).toBe(false);
    expect(() => requireRiotApiKey(config)).toThrow(ProviderNotConfiguredError);
  });

  it('validates numeric bounds and provider mode', () => {
    expect(() => loadRiotConfig({ RIOT_API_TIMEOUT_MS: '10' })).toThrow(ValidationFailureError);
    expect(() => loadRiotConfig({ RIOT_PROVIDER_MODE: 'live' })).toThrow(ValidationFailureError);
    expect(() => loadRiotConfig({ RIOT_API_BASE_DOMAIN: 'evil.example.com' })).toThrow(
      ValidationFailureError,
    );
  });

  it('loads approved numeric configuration', () => {
    const config = loadRiotConfig({
      RIOT_PROVIDER_MODE: 'real',
      RIOT_API_KEY: 'dev-key',
      RIOT_API_TIMEOUT_MS: '5000',
      RIOT_API_MAX_RETRIES: '1',
      RIOT_API_MAX_RETRY_DELAY_MS: '1000',
    });
    expect(config).toMatchObject({
      providerMode: 'real',
      apiKey: 'dev-key',
      timeoutMs: 5000,
      maxRetries: 1,
      maxRetryDelayMs: 1000,
      baseDomain: 'api.riotgames.com',
    });
  });
});
