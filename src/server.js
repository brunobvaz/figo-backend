import { startProductImageCleanupWorker } from './services/productImageCleanup.js';
import { startAccountDeletionWorker } from './services/accountService.js';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

import { startPushWorker } from './services/pushService.js';

let server;
let stopPushWorker;
let stopAccountDeletionWorker;
let stopProductImageCleanupWorker;
async function start() {
  await connectDatabase();
  stopPushWorker = startPushWorker();
  stopAccountDeletionWorker = startAccountDeletionWorker();
  stopProductImageCleanupWorker = startProductImageCleanupWorker();
  server = app.listen(env.PORT, () => console.info(`DaTerra API disponível em http://localhost:${env.PORT}`));
}

async function shutdown(signal) {
  console.info(`${signal} recebido. A terminar...`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopPushWorker?.();
  await stopAccountDeletionWorker?.();
  await stopProductImageCleanupWorker?.();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
start().catch(() => process.exit(1));
