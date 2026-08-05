import 'dotenv/config';
import { Redis } from 'ioredis';
import { loadDataDragonConfig } from '../../../config/data-dragon.config';
import { DataDragonChampionService } from '../data-dragon-champion.service';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const idRaw = readArg('--id');
  const keyRaw = readArg('--key');

  if (!idRaw && !keyRaw) {
    console.error('Usage: pnpm ddragon:champion --id 23');
    console.error('   or: pnpm ddragon:champion --key Tryndamere');
    process.exitCode = 1;
    return;
  }

  const config = loadDataDragonConfig();
  const redisUrl = (process.env.REDIS_URL ?? 'redis://localhost:6379').trim();
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

  const service = new DataDragonChampionService(config, redis);

  try {
    const champion = idRaw
      ? await service.getChampionByNumericId(Number(idRaw))
      : await service.getChampionByStringId(keyRaw!);

    if (!champion) {
      console.error(
        idRaw
          ? `No champion found for numeric id ${idRaw} (cache miss or Data Dragon unavailable).`
          : `No champion found for key ${keyRaw} (cache miss or Data Dragon unavailable).`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(champion, null, 2));
  } finally {
    redis.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
