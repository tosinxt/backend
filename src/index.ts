import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

import { router as authRouter } from './routes/auth';
import { router as invoicesRouter } from './routes/invoices';
import { router as templatesRouter } from './routes/templates';
import { router as settingsRouter } from './routes/settings';
import { router as profileRouter } from './routes/profile';
import { router as walletsRouter } from './routes/wallets';
import { router as cryptoRouter } from './routes/crypto';
import { router as publicRouter } from './routes/public';
import { router as emailRouter } from './routes/email';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const FRONTEND_ORIGINS = process.env.FRONTEND_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [FRONTEND_ORIGIN];

// Trust proxy so req.secure is correct behind reverse proxies (needed for Secure cookies)
app.set('trust proxy', 1);

// CORS: allow multiple origins and credentials for cookie/header-based auth
app.use(cors({
  origin(origin, callback) {
    // allow non-browser tools (no origin) and any configured origin
    if (!origin) return callback(null, true);
    if (FRONTEND_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));
app.use(cookieParser());
// Increase body size limits to support base64 image uploads (company logo)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/wallets', walletsRouter);
app.use('/api/crypto', cryptoRouter);
app.use('/api/public', publicRouter);
app.use('/api/email', emailRouter);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend running on http://localhost:${PORT}`);
});
