import fs from 'node:fs/promises';
import { avatarUploadDirectory, productUploadDirectory } from '../src/config/uploads.js';
import { warmImageVariants } from '../src/services/imageService.js';

let completed = 0, skipped = 0;
for (const [directory, widths] of [[avatarUploadDirectory, [160, 320]], [productUploadDirectory, [160, 640, 1280]]]) {
  for (const filename of await fs.readdir(directory)) {
    if (!/^[a-zA-Z0-9_-]+\.(jpe?g|png|webp)$/i.test(filename)) continue;
    try { await warmImageVariants(directory, filename, widths); completed++; }
    catch { skipped++; }
  }
}
console.log(`Imagens preparadas: ${completed}; ignoradas (inválidas/indisponíveis): ${skipped}. Originais preservados.`);
