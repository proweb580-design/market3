import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/load-env.js';
import { setupApp } from './setup.js';

/**
 * Vercel entry: the Nest app is built once per function instance and reused for every request it serves
 * (a cold start pays the bootstrap, warm requests don't). No listen(): Vercel hands us (req, res).
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let ready: Promise<Handler> | undefined;

async function boot(): Promise<Handler> {
  loadEnv();
  // rawBody: payment webhooks verify their signature over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupApp(app);
  await app.init();
  return app.getHttpAdapter().getInstance() as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // A failed boot must not be cached forever: drop it so the next request retries.
  ready ??= boot().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  (await ready)(req, res);
}
