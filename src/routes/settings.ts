import { Router } from 'express';
import { authMiddleware } from '../utils/authMiddleware';
import { supabaseAdmin } from '../lib/supabase';
import { z } from 'zod';

export const router = Router();

// Ensure the user is authenticated
router.use(authMiddleware as any);

// GET /api/settings - fetch user's settings
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: error.message });
    }

    const settings = data?.settings || {};
    return res.json({ settings });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Failed to load settings' });
  }
});

// PUT /api/settings - update/merge user's settings
router.put('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const patch = (req.body?.settings ?? {}) as Record<string, unknown>;

    // Load existing
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();

    if (readErr && readErr.code !== 'PGRST116') {
      return res.status(500).json({ error: readErr.message });
    }

    const next = { ...(existing?.settings || {}), ...patch };

    // Upsert into profiles
    const { error: upsertErr } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: user.id, settings: next }, { onConflict: 'id' });

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    return res.json({ settings: next });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Failed to save settings' });
  }
});

// POST /api/settings/company-logo - upload company logo, save path in settings.companyLogoPath
router.post('/company-logo', async (req, res) => {
  const user = (req as any).user;
  const BodySchema = z.object({
    fileBase64: z.string().min(10),
    contentType: z.string().min(3).optional(),
  });
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  try {
    const { fileBase64 } = parsed.data;
    let contentType = parsed.data.contentType || 'image/png';
    let base64 = fileBase64;
    const m = /^data:(.+?);base64,(.*)$/.exec(fileBase64);
    if (m) {
      contentType = m[1] || contentType;
      base64 = m[2];
    }
    const buffer = Buffer.from(base64, 'base64');
    const ext = contentType.includes('jpeg') ? 'jpg' : (contentType.split('/')[1] || 'png');
    const path = `${user.id}/company-logo.${ext}`;

    // Ensure bucket exists
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const exists = (buckets || []).some(b => b.name === 'logos');
      if (!exists) await supabaseAdmin.storage.createBucket('logos', { public: false });
    } catch {}

    const { error: upErr } = await supabaseAdmin.storage
      .from('logos')
      .upload(path, buffer, { contentType, upsert: true });
    if (upErr) return res.status(500).json({ error: upErr.message });

    // Merge settings.companyLogoPath
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();
    const settings = { ...(existing?.settings || {}), companyLogoPath: path } as Record<string, unknown>;
    const { error: saveErr } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: user.id, settings }, { onConflict: 'id' });
    if (saveErr) return res.status(500).json({ error: saveErr.message });

    return res.json({ path });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Failed to upload logo' });
  }
});

// GET /api/settings/company-logo-url - return signed URL for settings.companyLogoPath
router.get('/company-logo-url', async (req, res) => {
  const user = (req as any).user;
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
    const path = (data?.settings as any)?.companyLogoPath as string | undefined;
    if (!path) return res.json({ url: null });
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('logos')
      .createSignedUrl(path, 60 * 60);
    if (signErr) return res.status(500).json({ error: signErr.message });
    return res.json({ url: signed?.signedUrl || null });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Failed to create signed URL' });
  }
});
