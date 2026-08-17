import { runPlayerPlaystyleLiveEval } from './player-playstyle-live';
import { runPlayerPlaystyleOfflineEval } from './player-playstyle-offline';

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const result = live
    ? await runPlayerPlaystyleLiveEval({ env: process.env })
    : await runPlayerPlaystyleOfflineEval();
  process.exit(result.exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
