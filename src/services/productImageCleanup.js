import { Product } from '../models/Product.js';
import { withAccountLocks } from './accountGuard.js';
import { productImageFilenames } from '../utils/productImages.js';
import { purgeImage } from './imageService.js';
import { productUploadDirectory } from '../config/uploads.js';

// Removed filenames are committed with the gallery, so a failed unlink or
// process restart cannot lose the list of files still requiring cleanup.
export async function cleanProductImages(productId) {
  const owner = await Product.findById(productId).select('seller');
  if (!owner) return;
  return withAccountLocks([owner.seller], async () => {
    const product = await Product.findById(productId).select('+pendingImageFilenames');
    if (!product) return;
    const retained = new Set(product.status === 'deleted' ? [] : productImageFilenames(product));
    for (const filename of product.pendingImageFilenames || []) {
      if (retained.has(filename)) continue;
      try {
        await purgeImage(productUploadDirectory, filename);
        await Product.updateOne({ _id: productId }, { $pull: { pendingImageFilenames: filename } });
      } catch { /* Retry from the persisted pending list. */ }
    }
  });
}
export async function processProductImageCleanup() {
  const products = await Product.find({ 'pendingImageFilenames.0': { $exists: true } }).select('_id').limit(50);
  for (const product of products) await cleanProductImages(product.id);
}
export function startProductImageCleanupWorker() {
  let running;
  const tick = () => {
    if (running) return;
    running = processProductImageCleanup().catch(() => console.warn('Product image cleanup: retry scheduled.')).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 30000); timer.unref(); tick();
  return async () => { clearInterval(timer); await running; };
}
