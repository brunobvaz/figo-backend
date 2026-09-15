import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';

const missing = { $or: [{ images: { $exists: false } }, { images: null }] };
const hasString = field => ({ $and: [{ $eq: [{ $type: field }, 'string'] }, { $ne: [field, ''] }] });
export async function migrateProductImages(db, { dryRun = false } = {}) {
  const products = db.collection('products');
  const pending = await products.countDocuments(missing);
  if (dryRun) return { pending, modifiedCount: 0, total: await products.countDocuments() };
  // Additive, atomic per document and safe to repeat. Do not change availability,
  // titles, dates, IDs or the existing cover fields; no files are moved.
  const result = await products.updateMany(missing, [{ $set: {
    images: { $cond: [hasString('$imageFilename'), [{ filename: '$imageFilename' }], { $cond: [hasString('$image'), [{ url: '$image' }], []] }] },
    imagesRevision: { $ifNull: ['$imagesRevision', 0] }
  } }]);
  await products.updateMany({ imagesRevision: { $exists: false } }, { $set: { imagesRevision: 0 } });
  await products.createIndex({ 'images.filename': 1 }, { sparse: true });
  await products.createIndex({ imageFilename: 1 }, { sparse: true });
  return { pending, modifiedCount: result.modifiedCount, remaining: await products.countDocuments(missing) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await connectDatabase();
    const dryRun = !process.argv.includes('--apply');
    const result = await migrateProductImages(mongoose.connection.db, { dryRun });
    console.info(JSON.stringify({ database: mongoose.connection.name, dryRun, ...result }));
  } catch (error) { console.error('Migração não concluída:', error.code || error.name); process.exitCode = 1; }
  finally { await disconnectDatabase(); }
}
