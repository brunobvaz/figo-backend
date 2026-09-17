import { accountImageVisibility } from './middleware/accountImageVisibility.js';
import express from 'express';
import { imageDelivery } from './middleware/imageDelivery.js';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { globalLimiter } from './middleware/rateLimiters.js';
import { noSqlSanitize } from './middleware/noSqlSanitize.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { avatarUploadDirectory, productUploadDirectory } from './config/uploads.js';

const origins = `${env.CORS_ORIGIN},${env.BACKOFFICE_ORIGIN}`.split(',').map((origin) => origin.trim());
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
app.use(noSqlSanitize);

app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
// Public, immutable assets must not consume the application's API request budget.
app.use('/uploads/avatars', accountImageVisibility('avatar'), imageDelivery(avatarUploadDirectory));
app.use('/uploads/products', accountImageVisibility('product'), imageDelivery(productUploadDirectory));
app.use(globalLimiter);
app.use('/api/v1', routes);
app.use(notFound);
app.use(errorHandler);
