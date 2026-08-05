/**
 * While JSON mode is active, route console.log to stderr so shared logger.info
 * calls cannot pollute machine-readable stdout.
 */
export function withJsonStdoutGuard<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled) {
    return fn();
  }
  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
  return fn().finally(() => {
    console.log = originalLog;
  });
}
