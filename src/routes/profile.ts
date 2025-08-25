import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../utils/authMiddleware';
import { supabaseAdmin } from '../lib/supabase';

export const router = Router();

router.use(authMiddleware as any);

// GET /api/profile -> basic user profile
router.get('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[profile] GET / unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  console.log(`[profile] GET / user=${userId}`);
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, plan, avatar_id')
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.warn('[profile] get failed', { userId, error: error.message });
    return res.status(500).json({ error: error.message });
  }
  // If no row, upsert a minimal one
  if (!data) {
    const { data: created, error: upErr } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: userId }, { onConflict: 'id' })
      .select('id, name, plan, avatar_id')
      .single();
    if (upErr) {
      console.warn('[profile] upsert minimal failed', { userId, error: upErr.message });
      return res.status(500).json({ error: upErr.message });
    }
    console.log('[profile] get created minimal profile', { userId });
    return res.json({ profile: created });
  }
  console.log('[profile] get ok', { userId });
  return res.json({ profile: data });
});

// (logo handling moved to settings route)

// PATCH /api/profile -> update subset fields (currently avatar_id)
router.patch('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[profile] PATCH / unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  const PatchSchema = z.object({
    avatar_id: z.number().int().min(1).max(64).optional(),
    name: z.string().min(1).max(120).optional(),
  }).refine(v => Object.keys(v).length > 0, { message: 'No fields to update' });

  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn('[profile] patch invalid payload', { userId, issues: parsed.error.flatten() });
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
  }

  const updates: any = {};
  if (typeof parsed.data.avatar_id !== 'undefined') updates.avatar_id = parsed.data.avatar_id;
  if (typeof parsed.data.name !== 'undefined') updates.name = parsed.data.name;
  if (Object.keys(updates).length === 0) {
    console.warn('[profile] patch no valid fields', { userId });
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: userId, ...updates }, { onConflict: 'id' })
    .select('id, name, plan, avatar_id')
    .single();
  if (error) {
    console.warn('[profile] patch failed', { userId, error: error.message });
    return res.status(500).json({ error: error.message });
  }
  console.log('[profile] patch ok', { userId, changed: Object.keys(updates) });
  return res.json({ profile: data });
});
