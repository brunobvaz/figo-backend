import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import argon2 from 'argon2';
import { z } from 'zod';
import { Admin } from '../src/models/Admin.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';

// No public sign-up endpoint and no default administrator credentials.
async function readInput() {
  if (process.env.ADMIN_NAME && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    return { name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
  }
  if (!process.stdin.isTTY) throw new Error('Define ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD, ou executa num terminal interativo.');
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const name = await prompt.question('Nome do administrador: ');
    const email = await prompt.question('Email: ');
    process.stdout.write('Palavra-passe (mínimo 12 caracteres): '); muted = true;
    const password = await prompt.question(''); muted = false; process.stdout.write('\n');
    process.stdout.write('Confirmar palavra-passe: '); muted = true;
    const confirmation = await prompt.question(''); muted = false; process.stdout.write('\n');
    if (password !== confirmation) throw new Error('As palavras-passe não coincidem.');
    return { name, email, password };
  } finally { prompt.close(); }
}
try {
  const input = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().max(254).pipe(z.email()), password: z.string().min(12).max(256) }).parse(await readInput());
  await connectDatabase();
  await Admin.init();
  if (await Admin.exists({ email: input.email })) throw new Error('Já existe um administrador com este email. Nenhuma conta foi alterada.');
  await Admin.create({ name: input.name, email: input.email, passwordHash: await argon2.hash(input.password) });
  console.info('Administrador criado na collection admins.');
} catch (error) {
  console.error(error instanceof z.ZodError ? 'Dados inválidos. Usa um nome, email válido e palavra-passe entre 12 e 256 caracteres.' : error.message);
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
