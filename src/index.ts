import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { router as authRouter } from './routes/auth';
import { router as invoicesRouter } from './routes/invoices';
import { router as templatesRouter } from './routes/templates';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/templates', templatesRouter);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend running on http://localhost:${PORT}`);
});
