import 'dotenv/config';
import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
const read = async name => JSON.parse(await readFile(new URL(`../data/caop/2025/${name}.json`, import.meta.url), 'utf8'));
try {
  const [municipalities, parishes, source] = await Promise.all(['municipalities', 'parishes', 'source'].map(read));
  for (const [items, count, pattern] of [[municipalities, 308, /^\d{4}$/], [parishes, 3259, /^\d{4}[A-Z0-9]{2}$/]]) {
    if (items.length !== count || new Set(items.map(x => x.code)).size !== count || items.some(x => !pattern.test(x.code) || !x.name?.trim())) throw new Error('Dados CAOP incompletos ou inválidos.');
  }
  const codes = new Set(municipalities.map(x => x.code));
  if (parishes.some(x => !codes.has(x.municipalityCode))) throw new Error('Relação de freguesia inválida.');
  if (new Set(municipalities.map(x => x.region)).size !== 3) throw new Error('Falta cobertura regional.');
  if (process.argv.includes('--check')) { console.log('CAOP2025 validada: 308 concelhos e 3259 freguesias, incluindo Corvo estatístico.'); }
  else {
    if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'development', serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db;
    for (const [name, records] of [['municipalities', municipalities], ['parishes', parishes]]) {
      const collection = db.collection(name);
      await collection.createIndex({ version: 1, code: 1 }, { unique: true });
      await collection.bulkWrite(records.map(record => ({ updateOne: { filter: { version: source.version, code: record.code }, update: { $set: { ...record, version: source.version } }, upsert: true } })));
    }
    await db.collection('parishes').createIndex({ version: 1, municipalityCode: 1, name: 1 });
    await db.collection('products').createIndex({ geo: '2dsphere' });
    await db.collection('referenceDatasets').updateOne({ _id: 'caop' }, { $set: { ...source, activeVersion: source.version, importedAt: new Date() } }, { upsert: true });
    console.log('CAOP2025 importada e índice geográfico criado.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
