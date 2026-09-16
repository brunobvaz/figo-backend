import { pathToFileURL } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Transaction } from '../src/models/Transaction.js';

// Additive and repeatable. Never drops existing indexes or rewrites chat history.
export async function migrateChatTransactions() {
  await Transaction.createCollection();
  await Transaction.createIndexes();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await connectDatabase();
    await migrateChatTransactions();
    console.info('Compras no chat: coleção e índices preparados.');
  } catch (error) { console.error('Migração não concluída:', error.code || error.name); process.exitCode = 1; }
  finally { await disconnectDatabase(); }
}
