import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const avatarUploadDirectory = path.join(backendRoot, 'uploads', 'avatars');
export const productUploadDirectory = path.join(backendRoot, 'uploads', 'products');
