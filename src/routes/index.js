import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';
import chatRoutes from './chatRoutes.js';
import pushRoutes from './pushRoutes.js';
import adminRoutes from './adminRoutes.js';

import locationRoutes from './locationRoutes.js';
const router = Router();
router.use('/admin', adminRoutes);
router.use('/locations', locationRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/conversations', chatRoutes);
router.use('/push', pushRoutes);
export default router;
