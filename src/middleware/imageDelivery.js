import express from 'express';
import { imageVariant, IMAGE_WIDTHS, IMAGE_CACHE_CONTROL } from '../services/imageService.js';

export function imageDelivery(directory) {
  const router = express.Router();
  router.get('/:filename', async (req, res, next) => {
    if (req.query.w === undefined) return next();
    const width = Number(req.query.w);
    if (!IMAGE_WIDTHS.includes(width) || !/^[a-zA-Z0-9_-]+\.(jpe?g|png|webp)$/i.test(req.params.filename)) {
      return res.status(400).set('Cache-Control', 'no-store').end();
    }
    try {
      const file = await imageVariant(directory, req.params.filename, width);
      res.set('Cache-Control', IMAGE_CACHE_CONTROL);
      res.type('jpeg').sendFile(file, { dotfiles: 'allow' }, error => { if (error) next(error); });
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).set('Cache-Control', 'no-store').end();
      // Old/corrupt images or a saturated encoder retain the original delivery path.
      // Never cache a temporary fallback for a year under the thumbnail URL.
      res.locals.imageFallback = true;
      next();
    }
  });
  router.use(express.static(directory, {
    fallthrough: false, dotfiles: 'deny',
    setHeaders(res) { res.setHeader('Cache-Control', res.locals.imageFallback ? 'no-store' : IMAGE_CACHE_CONTROL); }
  }));
  return router;
}
