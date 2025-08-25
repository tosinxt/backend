import { Router, type CookieOptions } from 'express';
import { supabaseAnon, supabaseAdmin } from '../lib/supabase';

export const router = Router();

const COOKIE_NAME = 'sb_access_token';
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: isProd, // must be true on HTTPS (prod), false on http://localhost
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
  // leave expires/session for now; can set maxAge to token exp later
};

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (!supabaseAnon) return res.status(500).json({ error: 'Supabase not configured' });
  console.log(`[auth] POST /login email=${email}`);
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token || !data.user) {
    console.warn(`[auth] login failed email=${email} err=${error?.message}`);
    return res.status(401).json({ error: error?.message || 'Invalid credentials' });
  }

  const access = data.session.access_token;
  // Set httpOnly cookie for browser-based auth
  res.cookie(COOKIE_NAME, access, COOKIE_OPTS as any);

  // Fetch profile
  const { data: prof } = await supabaseAdmin.from('profiles').select('name, plan').eq('id', data.user.id).maybeSingle();
  const user = {
    id: data.user.id,
    email: data.user.email || email,
    name: prof?.name || (data.user.user_metadata?.name as string) || email.split('@')[0],
    plan: (prof?.plan as 'free' | 'pro') || 'free',
  };
  console.log(`[auth] login ok user=${data.user.id}`);
  // Also return the access token so mobile/Safari clients can use Authorization header
  return res.json({ user, accessToken: access });
});

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (!supabaseAnon) return res.status(500).json({ error: 'Supabase not configured' });
  console.log(`[auth] POST /register email=${email}`);
  const { data, error } = await supabaseAnon.auth.signUp({ email, password, options: { data: { name } } });
  if (error) {
    console.warn(`[auth] register failed email=${email} err=${error.message}`);
    return res.status(400).json({ error: error.message });
  }
  const u = data.user;
  if (u) {
    await supabaseAdmin.from('profiles').upsert({ id: u.id, name: name || email.split('@')[0], plan: 'free' });
    console.log(`[auth] register ok user=${u.id}`);
  } else {
    console.log('[auth] register ok (confirmation required)');
  }
  return res.json({ ok: true });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 } as any);
  console.log('[auth] POST /logout ok');
  return res.json({ ok: true });
});

router.post('/resend-confirmation', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!supabaseAnon) return res.status(500).json({ error: 'Supabase not configured' });
  console.log(`[auth] POST /resend-confirmation email=${email}`);
  const { error } = await supabaseAnon.auth.resend({ type: 'signup', email });
  if (error) {
    console.warn(`[auth] resend-confirmation failed email=${email} err=${error.message}`);
    return res.status(400).json({ error: error.message });
  }
  console.log('[auth] resend-confirmation ok');
  return res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!supabaseAnon) return res.status(500).json({ error: 'Supabase not configured' });
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const redirectTo = `${FRONTEND_ORIGIN}/reset-password`;
  console.log(`[auth] POST /forgot-password email=${email} redirectTo=${redirectTo}`);
  const { error } = await supabaseAnon.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    console.warn(`[auth] forgot-password failed email=${email} err=${error.message}`);
    return res.status(400).json({ error: error.message });
  }
  console.log('[auth] forgot-password ok');
  return res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = (req.cookies?.[COOKIE_NAME] as string | undefined) || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
  if (!token) {
    console.warn('[auth] GET /me unauthenticated (no token)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    console.warn(`[auth] GET /me invalid token err=${error?.message}`);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const { data: prof } = await supabaseAdmin.from('profiles').select('name, plan').eq('id', data.user.id).maybeSingle();
  const user = {
    id: data.user.id,
    email: data.user.email || '',
    name: prof?.name || (data.user.user_metadata?.name as string) || '',
    plan: (prof?.plan as 'free' | 'pro') || 'free',
  };
  console.log(`[auth] GET /me ok user=${data.user.id}`);
  return res.json({ user });
});
