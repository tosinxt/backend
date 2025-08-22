import { Router } from 'express';

export const router = Router();

router.post('/login', (req, res) => {
  const { email } = req.body as { email?: string };
  // Mock user
  const user = {
    id: '1',
    email,
    name: email?.split('@')[0] || 'user',
    plan: 'free',
  };
  res.json({ token: 'mock-token', user });
});

router.post('/register', (req, res) => {
  const { email, name } = req.body as { email?: string; name?: string };
  const user = {
    id: '1',
    email,
    name: name || email?.split('@')[0] || 'user',
    plan: 'free',
  };
  res.json({ token: 'mock-token', user });
});

router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});
