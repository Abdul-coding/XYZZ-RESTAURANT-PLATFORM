import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/swagger';

async function generate() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  const document = createOpenApiDocument(app);
  writeFileSync('openapi.json', `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

void generate();
