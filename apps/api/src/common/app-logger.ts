import { ConsoleLogger } from '@nestjs/common';

/** Nest logger wrapper reserved for redaction/structured logging hooks. */
export class AppLogger extends ConsoleLogger {}
