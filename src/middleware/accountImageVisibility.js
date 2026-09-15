import { User } from '../models/User.js';
import { Product } from '../models/Product.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Existing public URLs must not bypass a closed account. Original images remain
// on disk during a temporary pause but cannot be fetched from the API.
export const accountImageVisibility = kind => asyncHandler(async (req, res, next) => {
  const filename = decodeURIComponent(req.path.slice(1));
  const owner = kind === 'avatar'
    ? await User.exists({ avatarFilename: filename, status: 'active' })
    : await Product.findOne({ status: { $ne: 'deleted' }, $or: [{ imageFilename: filename }, { 'images.filename': filename }] }).select('seller').then(product => product && User.exists({ _id: product.seller, status: 'active' }));
  if (!owner) return res.status(404).set('Cache-Control', 'no-store').end();
  next();
});
