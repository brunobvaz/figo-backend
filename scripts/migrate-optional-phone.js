import { pathToFileURL } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import mongoose from 'mongoose';

// Build the replacement first so phone uniqueness remains enforced throughout.
export async function migrateOptionalPhone(db) {
  const users = db.collection('users');
  await users.createIndex({ phone: 1 }, {
    name: 'phone_optional_unique', unique: true,
    partialFilterExpression: { phone: { $type: 'string' } }
  });
  for (const index of await users.indexes()) {
    if (index.name !== 'phone_optional_unique' && index.unique && index.key.phone === 1
        && Object.keys(index.key).length === 1 && !index.partialFilterExpression && !index.sparse) {
      await users.dropIndex(index.name);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await connectDatabase();
    await migrateOptionalPhone(mongoose.connection.db);
    console.info('Migration concluída: telefone opcional, unicidade e dados preservados.');
  } catch (error) {
    console.error('Migration não concluída:', error.code || error.name);
    process.exitCode = 1;
  } finally { await disconnectDatabase(); }
}
