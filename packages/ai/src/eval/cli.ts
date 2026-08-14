import { runLiveEval } from './live';
import { runOfflineEval } from './offline';

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const result = live ? await runLiveEval({ env: process.env }) : await runOfflineEval();
  process.exit(result.exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
