/**
 * Champion aggregate CLI exit codes.
 *
 * 0 — success (status/audits may still report findings in the payload)
 * 1 — command execution failure (bad args, missing confirmation, batch failure, infra error)
 * 2 — integrity audit completed and found one or more integrity violations
 */
export const EXIT_SUCCESS = 0;
export const EXIT_COMMAND_FAILURE = 1;
export const EXIT_INTEGRITY_FAILURE = 2;
