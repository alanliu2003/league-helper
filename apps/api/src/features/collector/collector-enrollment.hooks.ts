import type {
  CollectorEnrollmentInput,
  CollectorEnrollmentResult,
} from './collector.types';

export type CollectorEnrollmentAccount = {
  id: string;
  provider: string;
  platformRoute: string;
};

export type MaybeEnrollHookInput = {
  enabled: boolean;
  enroll: (input: CollectorEnrollmentInput) => Promise<CollectorEnrollmentResult>;
  account: CollectorEnrollmentAccount;
  warn: (message: unknown) => void;
};

export async function maybeEnrollFromSearch(input: MaybeEnrollHookInput): Promise<void> {
  if (!input.enabled) {
    return;
  }

  try {
    const result = await input.enroll({
      account: input.account,
      source: 'PRODUCT_SEARCH',
    });
    if (!result.ok) {
      input.warn({
        message: 'Collector search enrollment skipped',
        code: result.code,
        playerAccountId: result.playerAccountId,
        platformRoute: result.platformRoute,
      });
    }
  } catch (error: unknown) {
    input.warn({
      message: 'Collector search enrollment failed',
      playerAccountId: input.account.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

export async function maybeEnrollFromBootstrap(input: MaybeEnrollHookInput): Promise<void> {
  if (!input.enabled) {
    return;
  }

  try {
    const result = await input.enroll({
      account: input.account,
      source: 'BOOTSTRAP',
    });
    if (!result.ok) {
      input.warn({
        message: 'Collector bootstrap enrollment skipped',
        code: result.code,
        playerAccountId: result.playerAccountId,
        platformRoute: result.platformRoute,
      });
    }
  } catch (error: unknown) {
    input.warn({
      message: 'Collector bootstrap enrollment failed',
      playerAccountId: input.account.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
