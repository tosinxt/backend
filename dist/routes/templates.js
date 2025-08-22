"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const supabase_1 = require("../lib/supabase");
const authMiddleware_1 = require("../utils/authMiddleware");
exports.router = (0, express_1.Router)();
// Require a valid Supabase session for all routes below
exports.router.use(authMiddleware_1.authMiddleware);
const TemplateItemSchema = zod_1.z.object({
    description: zod_1.z.string().min(1),
    quantity: zod_1.z.number().positive(),
    rate: zod_1.z.number().nonnegative(),
});
const CreateTemplateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(120),
    items: zod_1.z.array(TemplateItemSchema).min(1),
    tax_rate: zod_1.z.number().nonnegative().max(100).default(0),
    notes: zod_1.z.string().optional().default(''),
});
const UpdateTemplateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(120).optional(),
    items: zod_1.z.array(TemplateItemSchema).min(1).optional(),
    tax_rate: zod_1.z.number().nonnegative().max(100).optional(),
    notes: zod_1.z.string().optional(),
});
// GET /api/templates -> list templates
exports.router.get('/', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const { data, error } = await supabase_1.supabaseAdmin
        .from('invoice_templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ templates: data });
});
// POST /api/templates -> create template
exports.router.post('/', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const parsed = CreateTemplateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    const payload = { user_id: userId, ...parsed.data };
    const { data, error } = await supabase_1.supabaseAdmin
        .from('invoice_templates')
        .insert(payload)
        .select('*')
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
});
// PUT /api/templates/:id -> update template
exports.router.put('/:id', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const { id } = req.params;
    const parsed = UpdateTemplateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    const { data, error } = await supabase_1.supabaseAdmin
        .from('invoice_templates')
        .update(parsed.data)
        .eq('id', id)
        .eq('user_id', userId)
        .select('*')
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    if (!data)
        return res.status(404).json({ error: 'Template not found' });
    return res.json(data);
});
// DELETE /api/templates/:id -> delete template
exports.router.delete('/:id', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const { id } = req.params;
    const { error } = await supabase_1.supabaseAdmin
        .from('invoice_templates')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.status(204).send();
});
