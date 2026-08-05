import { InvalidCursorError } from '@league-helper/shared';

export type DecodedCursor = {
  capturedAt: Date;
  id: string;
};

export function encodeCursor(capturedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ capturedAt: capturedAt.toISOString(), id })).toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      capturedAt?: string;
      id?: string;
    };
    if (!parsed.capturedAt || !parsed.id) {
      throw new InvalidCursorError();
    }
    const capturedAt = new Date(parsed.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new InvalidCursorError();
    }
    return { capturedAt, id: parsed.id };
  } catch (error: unknown) {
    if (error instanceof InvalidCursorError) {
      throw error;
    }
    throw new InvalidCursorError();
  }
}
