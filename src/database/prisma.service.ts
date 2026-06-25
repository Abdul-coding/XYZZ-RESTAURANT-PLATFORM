import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { buildDatabaseUrl } from './database.config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = buildDatabaseUrl();
    if (!url) {
      throw new Error('DATABASE_URL is not configured');
    }

    super({
      adapter: new PrismaPg({ connectionString: url }),
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (err) {
      const errorCode = (err as { errorCode?: string })?.errorCode;

      if (errorCode === 'P1010') {
        const dbUrl = buildDatabaseUrl() ?? '';
        const redactedUrl = dbUrl.replace(/:(.*?)@/, ':****@');

        this.logger.error(
          [
            'Prisma failed to connect to Postgres (P1010: access denied).',
            'Update your DB env vars in `.env` to match your local Postgres user/password/database.',
            redactedUrl ? `Current DB connection (redacted): ${redactedUrl}` : 'Current DB configuration is empty.',
          ].join('\n'),
        );
      }

      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
