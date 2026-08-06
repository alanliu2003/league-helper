export type SyncChampionStaticArgs = {
  dryRun: boolean;
  json: boolean;
};

export function parseSyncArgs(argv: string[]): SyncChampionStaticArgs {
  const unknownFlags = argv.filter(
    (arg) => arg.startsWith('-') && arg !== '--dry-run' && arg !== '--json',
  );
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownFlags.join(', ')}`);
  }
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
  };
}
