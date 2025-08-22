import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { authMiddleware } from '../utils/authMiddleware';

export const router = Router();

// Require a valid Supabase session for all routes below
router.use(authMiddleware);

const TemplateItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  items: z.array(TemplateItemSchema).min(1),
  tax_rate: z.number().nonnegative().max(100).default(0),
  notes: z.string().optional().default(''),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  items: z.array(TemplateItemSchema).min(1).optional(),
  tax_rate: z.number().nonnegative().max(100).optional(),
  notes: z.string().optional(),
});

// GET /api/templates -> list templates
router.get('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const { data, error } = await supabaseAdmin
    .from('invoice_templates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ templates: data });
});

// POST /api/templates -> create template
router.post('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const parsed = CreateTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
  const payload = { user_id: userId, ...parsed.data };
  const { data, error } = await supabaseAdmin
    .from('invoice_templates')
    .insert(payload)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// PUT /api/templates/:id -> update template
router.put('/:id', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const { id } = req.params;
  const parsed = UpdateTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
  const { data, error } = await supabaseAdmin
    .from('invoice_templates')
    .update(parsed.data)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Template not found' });
  return res.json(data);
});

// DELETE /api/templates/:id -> delete template
router.delete('/:id', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('invoice_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});
