import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../utils/AppError.js';

export async function editorialImageFields(file, errorCode) {
  const failure = () => new AppError(422, errorCode, 'Seleciona uma fotografia JPEG, PNG ou WebP válida.', [{ field: 'image', message: 'Seleciona uma fotografia JPEG, PNG ou WebP válida.' }]);
  try {
    const image = sharp(file.buffer, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw failure();
    const imageData = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    if (imageData.length > 5 * 1024 * 1024) throw failure();
    return { image: null, imageData, imageMimeType: 'image/webp', imageVersion: randomUUID() };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw failure();
  }
}
