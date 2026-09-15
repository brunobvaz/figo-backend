export const MAX_PRODUCT_IMAGES = 6;

// Read both schemas during rollout. The original image remains the cover.
export function productImages(product = {}) {
  if (!product) return [];
  if (Array.isArray(product.images) && product.images.length) return product.images.map(image => image.filename ? { filename: image.filename } : { url: image.url }).filter(image => image.filename || image.url);
  if (product.imageFilename) return [{ filename: product.imageFilename }];
  if (product.image) return [{ url: product.image }];
  return [];
}
export function productImageFilenames(product = {}) {
  return [...new Set([product.imageFilename, ...productImages(product).map(image => image.filename)].filter(Boolean))];
}
export function coverFields(images) {
  return { imageFilename: images[0]?.filename || null, image: images[0]?.url || null };
}
