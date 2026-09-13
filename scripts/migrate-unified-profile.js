import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';

// Remove the obsolete field without touching the analytics choice or account data.
export async function migrateUnifiedProfile(db) {
  return db.collection('users').updateMany({ roles: { $exists: true } }, { $unset: { roles: '' } });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await connectDatabase();
    const result = await migrateUnifiedProfile(mongoose.connection.db);
    console.info(`Perfis atualizados: ${result.modifiedCount}`);
  } catch (error) { console.error('Migração não concluída:', error.code || error.name); process.exitCode = 1; }
  finally { await disconnectDatabase(); }
}
