// Bundles the compiled app (dist/serverless.js) into ONE file for Vercel: dist/serverless.bundle.mjs.
// Why: Nest 12 packages are ES modules while @nestjs/throttler is CommonJS and require()s them; some runtimes
// (Vercel's) refuse require() of ES modules (ERR_REQUIRE_ESM). Inlining every @nestjs/* package removes that require.
// Everything else stays external and is loaded from node_modules as usual.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys({ ...pkg.dependencies }).filter((d) => !d.startsWith('@nestjs/'));
// Optional Nest peers that are loaded lazily with a try/catch and are intentionally not installed.
const optional = ['@nestjs/microservices', '@nestjs/websockets', '@nestjs/platform-socket.io', '@nestjs/platform-fastify', 'class-validator', 'class-transformer', '@fastify/static', '@fastify/view', 'fastify', 'cache-manager', 'nats', 'mqtt', 'amqplib', 'amqp-connection-manager', 'kafkajs', 'ioredis', 'redis', 'grpc', '@grpc/grpc-js', '@grpc/proto-loader', '@nestjs/mongoose', 'swagger-ui-dist', 'ts-morph'];

await build({
  entryPoints: ['dist/serverless.js'],
  outfile: 'dist/serverless.bundle.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // CommonJS packages inlined into an ES bundle still need require(); give them one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: [...external, ...external.map((d) => `${d}/*`), ...optional, ...optional.map((d) => `${d}/*`), './generated/*', '*.node'],
  logLevel: 'warning',
});
console.log('bundle ready');
