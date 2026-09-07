import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';
import chatRoutes from './chatRoutes.js';
import pushRoutes from './pushRoutes.js';

const router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/conversations', chatRoutes);
router.use('/push', pushRoutes);
export default router;
