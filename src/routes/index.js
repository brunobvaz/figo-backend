import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';

const router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
export default router;
