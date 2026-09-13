import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';

export async function migrateProductActivation(db) {
  return db.collection('products').updateMany({ is_active: { $exists: false } }, { $set: { is_active: true } });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await connectDatabase();
    const result = await migrateProductActivation(mongoose.connection.db);
    console.info(`Migração concluída: ${result.modifiedCount} anúncios atualizados.`);
  } catch (error) { console.error('Migração não concluída:', error.code || error.name); process.exitCode = 1; }
  finally { await disconnectDatabase(); }
}
