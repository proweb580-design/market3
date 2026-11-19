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
  // abortOnError: false — by default Nest calls process.exit(1) on a startup error, which kills the function without a trace.
  const app = await NestFactory.create(AppModule, { rawBody: true, abortOnError: false });
  setupApp(app);
  await app.init();
  return app.getHttpAdapter().getInstance() as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // A failed boot must not be cached forever: drop it so the next request retries.
    ready ??= boot().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    (await ready)(req, res);
  } catch (error) {
    console.error('API failed to start:', error);
    const message = error instanceof Error ? error.message : String(error);
    // Only configuration problems are explained to the caller (they name variables, never values); anything else stays in the logs.
    const detail = message.startsWith('Invalid environment') ? message : undefined;
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ statusCode: 500, message: 'API failed to start', detail }));
  }
}
