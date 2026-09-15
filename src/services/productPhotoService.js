import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from '../utils/AppError.js';
import { productImages, MAX_PRODUCT_IMAGES } from '../utils/productImages.js';
import { productUploadDirectory } from '../config/uploads.js';
import { purgeImage, warmImageVariants } from './imageService.js';

export const removeProductPhoto = filename => purgeImage(productUploadDirectory, filename);
const extensions = { jpeg: '.jpg', png: '.png', webp: '.webp' };
export async function saveProductPhoto(file) {
  if (!file.buffer?.length) throw new AppError(422, 'EMPTY_PRODUCT_IMAGE', 'Uma das fotografias está vazia. Seleciona-a novamente.');
  if (file.buffer.length > 5 * 1024 * 1024) throw new AppError(422, 'PRODUCT_IMAGE_TOO_LARGE', 'Cada fotografia pode ter até 5 MB.');
  let metadata;
  try { metadata = await sharp(file.buffer, { limitInputPixels: 50_000_000 }).metadata(); }
  catch { throw new AppError(422, 'INVALID_PRODUCT_IMAGE', 'Uma das fotografias não é uma imagem válida.'); }
  if (!extensions[metadata.format] || !metadata.width || !metadata.height || metadata.width * metadata.height > 50_000_000) throw new AppError(422, 'INVALID_PRODUCT_IMAGE', 'Escolhe fotografias JPEG, PNG ou WebP até 50 megapíxeis.');
  await fs.mkdir(productUploadDirectory, { recursive: true });
  const filename = `${crypto.randomUUID()}${extensions[metadata.format]}`;
  const target = path.join(productUploadDirectory, filename);
  try { await fs.writeFile(target, file.buffer); }
  catch (error) { await fs.unlink(target).catch(() => {}); throw error; }
  warmImageVariants(productUploadDirectory, filename, [160, 640, 1280]).catch(() => {});
  return { filename };
}

// Resolve every reference before writing files. Only images belonging to this
// product can be retained; all new uploads must be used exactly once.
export async function prepareProductPhotos(product, input, files, saved) {
  const uploads = files ? Array.isArray(files) ? files : [files] : [];
  const current = productImages(product);
  const { imageOrder, imagesRevision, image } = input;
  if (uploads.length > MAX_PRODUCT_IMAGES) throw new AppError(422, 'TOO_MANY_PRODUCT_IMAGES', 'Podes adicionar até 6 fotografias.');
  if (imageOrder !== undefined && image !== undefined) throw new AppError(422, 'AMBIGUOUS_PRODUCT_IMAGES', 'Envia apenas a lista de fotografias.');
  if (imageOrder && product?._id && imagesRevision !== (product.imagesRevision || 0)) throw new AppError(409, 'PRODUCT_IMAGES_CHANGED', 'As fotografias deste anúncio foram alteradas. Reabre a edição antes de guardar.');
  let order;
  if (imageOrder) {
    if (imageOrder.length < 1 || imageOrder.length > MAX_PRODUCT_IMAGES) throw new AppError(422, 'INVALID_PRODUCT_IMAGE_COUNT', 'Seleciona entre 1 e 6 fotografias.');
    const keys = imageOrder.map(ref => ref.upload !== undefined ? `upload:${ref.upload}` : ref.filename ? `file:${ref.filename}` : `url:${ref.url}`);
    if (new Set(keys).size !== keys.length) throw new AppError(422, 'DUPLICATE_PRODUCT_IMAGES', 'A mesma fotografia não pode ser repetida.');
    order = imageOrder.map(ref => {
      if (ref.upload !== undefined) {
        if (!Number.isInteger(ref.upload) || !uploads[ref.upload]) throw new AppError(422, 'INVALID_PRODUCT_IMAGE_REFERENCE', 'Falta uma das fotografias selecionadas.');
        return ref;
      }
      const found = current.find(item => ref.filename ? item.filename === ref.filename : item.url === ref.url);
      if (!found) throw new AppError(422, 'INVALID_PRODUCT_IMAGE_REFERENCE', 'A fotografia já não pertence a este anúncio. Reabre a edição.');
      return found;
    });
    if (order.filter(ref => ref.upload !== undefined).length !== uploads.length) throw new AppError(422, 'UNUSED_PRODUCT_IMAGES', 'A lista de fotografias não corresponde aos ficheiros enviados.');
  } else if (uploads.length) {
    // Old clients replace the cover only, preserving any remaining photographs.
    order = uploads.length === 1 ? [{ upload: 0 }, ...current.slice(1)] : [...current, ...uploads.map((_, upload) => ({ upload }))];
  } else if (image !== undefined) order = image ? [{ url: image }, ...current.slice(1)] : current.slice(1);
  else return { images: current, changed: false };
  if (order.length > MAX_PRODUCT_IMAGES) throw new AppError(422, 'TOO_MANY_PRODUCT_IMAGES', 'Podes adicionar até 6 fotografias.');
  for (const file of uploads) saved.push(await saveProductPhoto(file));
  const images = order.map(ref => ref.upload !== undefined ? saved[ref.upload] : ref);
  return { images, changed: JSON.stringify(images) !== JSON.stringify(current) };
}
