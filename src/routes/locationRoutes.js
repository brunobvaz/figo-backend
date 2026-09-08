import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { activeVersion } from '../services/locationService.js';
const router = Router();
router.get('/municipalities', asyncHandler(async (_req, res) => {
  const version = await activeVersion();
  const items = await mongoose.connection.db.collection('municipalities').find({ version }, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  res.json({ success: true, data: { version, items } });
}));
router.get('/parishes', asyncHandler(async (req, res) => {
  const municipalityCode = z.string().regex(/^\d{4}$/).parse(req.query.municipalityCode);
  const version = await activeVersion();
  const items = await mongoose.connection.db.collection('parishes').find({ version, municipalityCode }, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  res.json({ success: true, data: { version, items } });
}));
export default router;
