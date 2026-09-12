import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

export const IMAGE_WIDTHS = [160, 320, 640, 1280];
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const pending = new Map();
let running = 0;
const waiting = [];
async function withSlot(work) {
  if (running >= 2) {
    if (waiting.length >= 32) throw Object.assign(new Error('Image queue full'), { code: 'IMAGE_BUSY' });
    await new Promise(resolve => waiting.push(resolve));
  } else running++;
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else running--; }
}

// Derived files are disposable. Originals and database filenames are never modified.
export async function imageVariant(directory, filename, width) {
  if (!/^[a-zA-Z0-9_-]+\.(jpe?g|png|webp)$/i.test(filename) || !IMAGE_WIDTHS.includes(width)) {
    throw Object.assign(new Error('Invalid image variant'), { code: 'INVALID_IMAGE_VARIANT' });
  }
  const original = path.join(directory, filename);
  const stat = await fs.stat(original);
  const target = path.join(directory, '.variants', 'v1', `${filename}-${stat.size}-${Math.trunc(stat.mtimeMs)}-${width}.jpg`);
  try { await fs.access(target); return target; } catch { /* Generate this version once. */ }
  if (pending.has(target)) return pending.get(target);
  const work = withSlot(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await sharp(original, { limitInputPixels: 50_000_000 }).rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 78, progressive: true, mozjpeg: true }).toFile(temporary);
      await fs.access(original);
      await fs.rename(temporary, target);
      return target;
    } finally { await fs.unlink(temporary).catch(() => {}); }
  });
  pending.set(target, work);
  try { return await work; } finally { pending.delete(target); }
}

export async function warmImageVariants(directory, filename, widths) {
  for (const width of widths) await imageVariant(directory, filename, width);
}

export async function removeImageVariants(directory, filename) {
  const folder = path.join(directory, '.variants', 'v1');
  const entries = await fs.readdir(folder).catch(() => []);
  await Promise.all(entries.filter(name => name.startsWith(`${filename}-`)).map(name => fs.unlink(path.join(folder, name)).catch(() => {})));
}
