import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/app-logger';
import { DomainExceptionFilter } from './common/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new AppLogger(),
  });

  app.useGlobalFilters(new DomainExceptionFilter());

  const corsOriginRaw = process.env.API_CORS_ORIGIN ?? 'http://localhost:3000';
  const corsOrigins = new Set(
    corsOriginRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  // Accept both localhost and 127.0.0.1 for the same port (Playwright / Nuxt host variants).
  for (const origin of [...corsOrigins]) {
    if (origin.includes('localhost')) {
      corsOrigins.add(origin.replace('localhost', '127.0.0.1'));
    }
    if (origin.includes('127.0.0.1')) {
      corsOrigins.add(origin.replace('127.0.0.1', 'localhost'));
    }
  }
  app.enableCors({
    origin: [...corsOrigins],
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
