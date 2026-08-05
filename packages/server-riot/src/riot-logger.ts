/** Minimal logger surface used by RiotApiClient (framework-independent). */
export type RiotLogger = {
  log(message: string): void;
  warn(message: string): void;
};

/** Console-backed default logger suitable for CLI and Nest factory wiring. */
export function createConsoleRiotLogger(context = 'RiotApiClient'): RiotLogger {
  return {
    log(message: string): void {
      console.log(`[${context}] ${message}`);
    },
    warn(message: string): void {
      console.warn(`[${context}] ${message}`);
    },
  };
}
