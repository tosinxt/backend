import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../utils/authMiddleware';
import { sendMail, renderEmail, plainTextFromHtml, transporter } from '../lib/mailer';
import { supabaseAdmin } from '../lib/supabase';
import { createHmac } from 'crypto';

export const router = Router();

router.use(authMiddleware as any);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

function getPublicSecret(): string {
  const s = process.env.PUBLIC_SHARE_SECRET;
  if (!s) throw new Error('PUBLIC_SHARE_SECRET is not set');
  return s;
}

function makePublicToken(userId: string, invoiceId: string): string {
  const h = createHmac('sha256', getPublicSecret());
  h.update(`${userId}:${invoiceId}`);
  return h.digest('hex');
}

// POST /api/email/send - generic email
router.post('/send', async (req, res) => {
  const Body = z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    html: z.string().optional(),
    text: z.string().optional(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  try {
    const info = await sendMail(parsed.data);
    return res.json({ ok: true, id: info.messageId });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to send email' });
  }
});

// GET /api/email/status - SMTP readiness
router.get('/status', async (_req, res) => {
  try {
    const host = !!process.env.SMTP_HOST;
    const user = !!process.env.SMTP_USER;
    const pass = !!process.env.SMTP_PASS;
    let verified = false;
    try {
      verified = await transporter.verify();
    } catch {
      verified = false;
    }
    return res.json({ ok: true, smtp: { host, user, pass, verified } });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to get email status' });
  }
});

// GET /api/email/settings - get email branding/settings from profile
router.get('/settings', async (req, res) => {
  const user = (req as any).user;
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    const s = (data?.settings || {}) as any;
    const email = s.email || {};
    return res.json({
      ok: true,
      settings: {
        fromName: email.fromName || process.env.MAIL_FROM_NAME || 'Ledgr',
        fromEmail: email.fromEmail || process.env.MAIL_FROM_EMAIL || 'no-reply@example.com',
        brandName: email.brandName || process.env.MAIL_FROM_NAME || 'Ledgr',
        replyTo: email.replyTo || undefined,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to load email settings' });
  }
});

// PATCH /api/email/settings - update email settings in profile.settings
router.patch('/settings', async (req, res) => {
  const user = (req as any).user;
  const Body = z.object({
    fromName: z.string().min(1).optional(),
    fromEmail: z.string().email().optional(),
    brandName: z.string().min(1).optional(),
    replyTo: z.string().email().optional(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  try {
    const { data: current, error: loadErr } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();
    if (loadErr) return res.status(500).json({ error: loadErr.message });
    const next = { ...(current?.settings || {}) } as any;
    next.email = { ...(next.email || {}), ...parsed.data };
    const { error: updErr } = await supabaseAdmin
      .from('profiles')
      .update({ settings: next })
      .eq('id', user.id);
    if (updErr) return res.status(500).json({ error: updErr.message });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to update email settings' });
  }
});

// POST /api/email/send-test - send a test email
router.post('/send-test', async (req, res) => {
  const user = (req as any).user;
  const Body = z.object({ to: z.string().email(), message: z.string().optional() });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  try {
    // Load branding from settings
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();
    const s = (data?.settings || {}) as any;
    const email = s.email || {};
    const brand = email.brandName || process.env.MAIL_FROM_NAME || 'Ledgr';
    const html = renderEmail({
      title: 'Test email',
      heading: 'Email configuration looks good',
      previewText: 'This is a test email from your app settings.',
      brandName: brand,
      bodyHtml: `<p>${parsed.data.message || 'This is a test email to confirm your SMTP settings.'}</p>`,
    });
    const info = await sendMail({
      to: parsed.data.to,
      subject: `Test email from ${brand}`,
      html,
      text: plainTextFromHtml(html),
      fromName: email.fromName,
      fromEmail: email.fromEmail,
    });
    return res.json({ ok: true, id: info.messageId });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to send test email' });
  }
});

// POST /api/email/send-invoice - send invoice public link to a recipient
router.post('/send-invoice', async (req, res) => {
  const user = (req as any).user;
  const Body = z.object({
    invoiceId: z.string().min(1),
    to: z.string().email(),
    message: z.string().optional(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  try {
    // Verify invoice belongs to user
    const { data: inv, error } = await supabaseAdmin
      .from('invoices')
      .select('id,user_id,amount,currency')
      .eq('id', parsed.data.invoiceId)
      .eq('user_id', user.id)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    // Build public URL
    const token = makePublicToken(String(inv.user_id), String(inv.id));
    const url = `${FRONTEND_ORIGIN}/p/${inv.id}?token=${token}`;

    const shortId = String(inv.id).slice(0, 8).toUpperCase();
    const subject = `Invoice ${shortId}`;
    // inv.amount is stored in cents in our application layer; format to dollars
    let amount: string | undefined;
    const amt: unknown = (inv as any).amount;
    if (typeof amt === 'number') amount = (amt / 100).toFixed(2);
    else if (typeof amt === 'string') {
      const n = Number(amt);
      if (!Number.isNaN(n)) amount = (n / 100).toFixed(2);
    }

    // Load branding overrides
    const { data: prof } = await supabaseAdmin.from('profiles').select('settings').eq('id', user.id).single();
    const s = (prof?.settings || {}) as any;
    const emailCfg = s.email || {};
    const brand = emailCfg.brandName || process.env.MAIL_FROM_NAME || 'Ledgr';

    const bodyHtml = `
      <p>${parsed.data.message ? parsed.data.message : 'Please find your invoice below.'}</p>
      <p><strong>Invoice:</strong> ${shortId}${amount ? ` · <strong>Total:</strong> ${amount} ${inv.currency || ''}` : ''}</p>
      <p style="margin:18px 0;">
        <a class="btn" href="${url}" target="_blank" rel="noopener">View invoice</a>
      </p>
      <p class="muted">If the button doesn't work, copy and paste this link into your browser:</p>
      <p><a href="${url}" target="_blank" rel="noopener">${url}</a></p>
    `;
    const html = renderEmail({
      title: subject,
      heading: subject,
      previewText: `View invoice ${shortId}`,
      bodyHtml,
      brandName: brand,
    });
    const text = plainTextFromHtml(bodyHtml);

    const info = await sendMail({
      to: parsed.data.to,
      subject,
      html,
      text,
      fromName: emailCfg.fromName,
      fromEmail: emailCfg.fromEmail,
    });
    return res.json({ ok: true, id: info.messageId, url });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to send invoice email' });
  }
});
