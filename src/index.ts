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

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
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
