import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDatabase(uri = env.MONGODB_URI) {
  try {
    await mongoose.connect(uri, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 10000 });
    console.info(`MongoDB ligado à base de dados "${mongoose.connection.name}".`);
  } catch (error) {
    console.error('Falha ao ligar ao MongoDB:', error.message);
    throw error;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
