import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';

// Verifies the Supabase JWT from the Authorization header and attaches user to req
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

  // Attach minimal user info
  (req as any).user = data.user;
  return next();
}
