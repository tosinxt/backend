import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { authMiddleware } from '../utils/authMiddleware';
import type { Response } from 'express';
import { createHmac } from 'crypto';

export const router = Router();

// Require a valid Supabase session for all routes below
router.use(authMiddleware);

// Helpers and route for generating a public view URL with HMAC token
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

// GET /api/invoices/:id/public-url -> returns a public HTML view URL with token
router.get('/:id/public-url', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing invoice id' });
  try {
    const { data: inv, error } = await supabaseAdmin
      .from('invoices')
      .select('id,user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const token = makePublicToken(String(inv.user_id), String(inv.id));
    const frontend = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
    const url = `${frontend}/p/${inv.id}?token=${token}`;
    return res.json({ url, token });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

// GET /api/invoices -> list invoices
router.get('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[invoices] GET / unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  console.log(`[invoices] GET / list user=${userId}`);
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn(`[invoices] list failed user=${userId} err=${error.message}`);
    return res.status(500).json({ error: error.message });
  }
  console.log(`[invoices] list ok user=${userId} count=${data?.length ?? 0}`);
  return res.json({ invoices: data });
});

// GET /api/invoices/:id -> fetch one invoice
router.get('/:id', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[invoices] GET /:id unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const { id } = req.params;
  if (!id) {
    console.warn('[invoices] get one missing id');
    return res.status(400).json({ error: 'Missing invoice id' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error) {
      console.warn('[invoices] get one failed', { userId, id, error: error.message });
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'Invoice not found' });
    return res.json(data);
  } catch (e: any) {
    console.error('[invoices] get one threw', { userId, id, error: e });
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

// POST /api/invoices -> create invoice
router.post('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[invoices] POST / unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const ItemSchema = z.object({ description: z.string().min(1), quantity: z.number().positive(), rate: z.number().nonnegative(), amount: z.number().nonnegative().optional() });
  const CreateInvoiceSchema = z.object({
    // If items provided, server will compute amount
    amount: z.number().int().positive().optional(),
    currency: z.string().min(3).max(10),
    customer: z.string().min(1).max(120),
    items: z.array(ItemSchema).optional(),
    tax_rate: z.number().nonnegative().max(100).optional(),
    notes: z.string().optional(),
    company_name: z.string().optional(),
    company_address: z.string().optional(),
    client_email: z.string().email().optional(),
    client_address: z.string().optional(),
    issue_date: z.string().optional(),
    due_date: z.string().optional(),
    template_kind: z.enum(['simple','detailed','proforma']).optional(),
  });
  const parsed = CreateInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn('[invoices] create invalid payload', { issues: parsed.error.flatten() });
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
  }
  const { currency, customer } = parsed.data;
  const items = parsed.data.items || [];
  const taxRate = parsed.data.tax_rate ?? 0;
  let amount = parsed.data.amount;
  if (items.length > 0) {
    const subtotal = items.reduce((sum, it) => sum + (it.quantity * it.rate), 0);
    const tax = subtotal * (taxRate / 100);
    amount = Math.round((subtotal + tax) * 100); // cents
  }
  if (!amount || amount <= 0) {
    console.warn(`[invoices] create invalid amount user=${userId} amount=${amount}`);
    return res.status(400).json({ error: 'Invalid amount. Provide positive amount or valid items/tax_rate.' });
  }

  const payload: any = {
    user_id: userId,
    amount,
    currency,
    customer,
    status: 'pending' as const,
    items: items.length > 0 ? items.map(it => ({ description: it.description, quantity: it.quantity, rate: it.rate })) : null,
    tax_rate: items.length > 0 ? taxRate : null,
    notes: parsed.data.notes ?? null,
    company_name: parsed.data.company_name ?? null,
    company_address: parsed.data.company_address ?? null,
    client_email: parsed.data.client_email ?? null,
    client_address: parsed.data.client_address ?? null,
    issue_date: parsed.data.issue_date ? new Date(parsed.data.issue_date) : null,
    due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null,
    template_kind: parsed.data.template_kind ?? 'simple',
  };
  try {
    const { data, error } = await supabaseAdmin.from('invoices').insert(payload).select('*').single();
    if (error) {
      console.warn('[invoices] create failed', { userId, error: error.message });
      return res.status(500).json({ error: error.message });
    }
    console.log(`[invoices] create ok user=${userId} id=${data?.id}`);
    return res.status(201).json(data);
  } catch (e: any) {
    console.error('[invoices] create threw', { userId, error: e });
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

// POST /api/invoices/:id/pay -> mark paid
router.post('/:id/pay', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[invoices] POST /:id/pay unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const { id } = req.params;
  if (!id) {
    console.warn('[invoices] pay missing id');
    return res.status(400).json({ error: 'Missing invoice id' });
  }
  console.log(`[invoices] POST /${id}/pay user=${userId}`);
  try {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'paid' })
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) {
      console.warn('[invoices] pay failed', { userId, id, error: error.message });
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      console.warn('[invoices] pay not found', { userId, id });
      return res.status(404).json({ error: 'Invoice not found' });
    }
    console.log(`[invoices] pay ok user=${userId} id=${id}`);
    return res.json(data);
  } catch (e: any) {
    console.error('[invoices] pay threw', { userId, id, error: e });
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

// PATCH /api/invoices/:id -> update invoice fields
router.patch('/:id', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[invoices] PATCH /:id unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const { id } = req.params;
  if (!id) {
    console.warn('[invoices] patch missing id');
    return res.status(400).json({ error: 'Missing invoice id' });
  }

  const ItemSchema = z.object({ description: z.string().min(1), quantity: z.number().positive(), rate: z.number().nonnegative() });
  const PatchSchema = z.object({
    amount: z.number().int().positive().optional(),
    currency: z.string().min(3).max(10).optional(),
    customer: z.string().min(1).max(120).optional(),
    items: z.array(ItemSchema).optional(),
    tax_rate: z.number().nonnegative().max(100).optional(),
    notes: z.string().optional(),
    company_name: z.string().optional(),
    company_address: z.string().optional(),
    client_email: z.string().email().optional(),
    client_address: z.string().optional(),
    issue_date: z.string().optional(),
    due_date: z.string().optional(),
    template_kind: z.enum(['simple', 'detailed', 'proforma']).optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn('[invoices] patch invalid payload', { issues: parsed.error.flatten() });
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
  }

  try {
    // Fetch existing invoice for context (to recompute amount or preserve values)
    const { data: existing, error: getErr } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (getErr) {
      console.warn('[invoices] patch fetch existing failed', { userId, id, error: getErr.message });
      return res.status(500).json({ error: getErr.message });
    }
    if (!existing) {
      console.warn('[invoices] patch not found', { userId, id });
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const body = parsed.data;
    const updates: any = {};
    if (typeof body.template_kind !== 'undefined') updates.template_kind = body.template_kind;
    if (typeof body.currency !== 'undefined') updates.currency = body.currency;
    if (typeof body.customer !== 'undefined') updates.customer = body.customer;
    if (typeof body.notes !== 'undefined') updates.notes = body.notes ?? null;
    if (typeof body.company_name !== 'undefined') updates.company_name = body.company_name ?? null;
    if (typeof body.company_address !== 'undefined') updates.company_address = body.company_address ?? null;
    if (typeof body.client_email !== 'undefined') updates.client_email = body.client_email ?? null;
    if (typeof body.client_address !== 'undefined') updates.client_address = body.client_address ?? null;
    if (typeof body.issue_date !== 'undefined') updates.issue_date = body.issue_date ? new Date(body.issue_date) : null;
    if (typeof body.due_date !== 'undefined') updates.due_date = body.due_date ? new Date(body.due_date) : null;

    // Handle items and tax/amount recalculation rules
    let itemsChanged = false;
    if (typeof body.items !== 'undefined') {
      const arr = Array.isArray(body.items) ? body.items : [];
      updates.items = arr.length > 0 ? arr.map(it => ({ description: it.description, quantity: it.quantity, rate: it.rate })) : null;
      itemsChanged = true;
    }
    if (typeof body.tax_rate !== 'undefined') {
      updates.tax_rate = (itemsChanged ? (Array.isArray(body.items) && body.items.length > 0 ? body.tax_rate ?? 0 : null) : body.tax_rate);
    }

    // Decide final amount
    let amountCents: number | undefined = undefined;
    const effectiveItems = (typeof updates.items !== 'undefined') ? updates.items : existing.items;
    const effectiveTax = (typeof updates.tax_rate !== 'undefined') ? updates.tax_rate : existing.tax_rate;
    if (Array.isArray(effectiveItems) && effectiveItems.length > 0) {
      const subtotal = effectiveItems.reduce((sum: number, it: any) => sum + (Number(it.quantity) * Number(it.rate)), 0);
      const tax = subtotal * (Number(effectiveTax || 0) / 100);
      amountCents = Math.round((subtotal + tax) * 100);
    } else if (typeof body.amount !== 'undefined') {
      amountCents = body.amount;
    }
    if (typeof amountCents !== 'undefined') {
      if (!(amountCents > 0)) return res.status(400).json({ error: 'Invalid amount after update' });
      updates.amount = amountCents;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) {
      console.warn('[invoices] patch failed', { userId, id, error: error.message });
      return res.status(500).json({ error: error.message });
    }
    console.log(`[invoices] patch ok user=${userId} id=${id}`);
    return res.json(data);
  } catch (e: any) {
    console.error('[invoices] patch threw', { userId, id, error: e });
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

// GET /api/invoices/:id/pdf -> download invoice as PDF
router.get('/:id/pdf', async (req, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[invoices] GET /:id/pdf unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const { id } = req.params;
  if (!id) {
    console.warn('[invoices] pdf missing id');
    return res.status(400).json({ error: 'Missing invoice id' });
  }
  console.log(`[invoices] GET /${id}/pdf user=${userId}`);

  try {
    const { data: inv, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.warn('[invoices] pdf fetch failed', { userId, id, error: error.message });
      return res.status(500).json({ error: error.message });
    }
    if (!inv) {
      console.warn('[invoices] pdf not found', { userId, id });
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Fetch profile for branding (name)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .single();

    // Build a pretty, deterministic filename
    const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    const date = new Date(inv.created_at).toISOString().slice(0, 10);
    const filename = `invoice-${safe(inv.customer)}-${date}-${String(inv.id).slice(0,8)}.pdf`;
    const storagePath = `${userId}/${filename}`;

    // Create PDF into a buffer so we can both return it and upload to storage
    // Lazy require to avoid TS type friction
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Accent bar header
      const pageWidth = doc.page.width;
      const margin = 50;
      doc.save();
      doc.rect(0, 0, pageWidth, 60).fill('#0ea5e9'); // sky-500
      doc.fill('#ffffff').fontSize(22).text('INVOICE', margin, 20, { align: 'left' });
      doc.fill('#ffffff').fontSize(12).text(profile?.name || 'Ledgr', margin, 22, { align: 'right', width: pageWidth - margin * 2 });
      doc.restore();
      doc.moveDown(1.5);

      // Meta block
      doc.fontSize(10).fillColor('#444');
      doc.text(`Invoice ID: ${inv.id}`);
      doc.text(`Date: ${new Date(inv.created_at).toLocaleDateString()}`);
      doc.text(`Status: ${inv.status}`);
      doc.fillColor('#000').moveDown();

      // Company / Client info
      const yStart = doc.y;
      doc.fontSize(12).fillColor('#111').text('From', margin, yStart, { underline: true });
      doc.fontSize(11).fillColor('#000').text(inv.company_name || (profile?.name || 'Ledgr'));
      if (inv.company_address) doc.fontSize(10).fillColor('#444').text(inv.company_address).fillColor('#000');

      const xRight = 320;
      doc.fontSize(12).fillColor('#111').text('Bill To', xRight, yStart, { underline: true });
      doc.fontSize(11).fillColor('#000').text(inv.customer, xRight);
      if (inv.client_email) doc.fontSize(10).fillColor('#444').text(inv.client_email, xRight).fillColor('#000');
      if (inv.client_address) doc.fontSize(10).fillColor('#444').text(inv.client_address, xRight).fillColor('#000');
      doc.moveDown();

      // Dates
      if (inv.issue_date || inv.due_date) {
        doc.moveDown(0.2);
        doc.fontSize(12).text('Dates', { underline: true }).moveDown(0.2);
        doc.fontSize(11);
        if (inv.issue_date) doc.text(`Issue Date: ${new Date(inv.issue_date).toLocaleDateString()}`);
        if (inv.due_date) doc.text(`Due Date: ${new Date(inv.due_date).toLocaleDateString()}`);
        doc.moveDown();
      }

      // Itemized lines
      const currency = String(inv.currency).toUpperCase();
      const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency });
      let subtotal = 0;
      if (Array.isArray(inv.items) && inv.items.length > 0) {
        doc.fontSize(12).text('Items', { underline: true }).moveDown(0.5);
        // Shaded table header
        const headerY = doc.y;
        doc.save();
        doc.rect(margin, headerY - 4, pageWidth - margin * 2, 20).fill('#f1f5f9'); // slate-100
        doc.restore();
        doc.fontSize(10).fillColor('#111').text('Description', margin + 5, headerY, { width: 240 });
        doc.text('Qty', 300, headerY, { width: 40 });
        doc.text('Rate', 360, headerY, { width: 80 });
        doc.text('Amount', 450, headerY, { width: 90 });
        doc.moveTo(margin, headerY + 18).lineTo(pageWidth - margin, headerY + 18).strokeColor('#e5e7eb').stroke().strokeColor('#000');
        doc.moveDown(0.6);

        inv.items.forEach((it: any, idx: number) => {
          const qty = Number(it.quantity || 0);
          const rate = Number(it.rate || 0);
          const line = qty * rate;
          subtotal += line;
          const y = doc.y;
          // Optional row striping
          if (idx % 2 === 1) {
            doc.save();
            doc.rect(margin, y - 2, pageWidth - margin * 2, 18).fill('#fafafa');
            doc.restore();
          }
          doc.fontSize(10).fillColor('#000').text(String(it.description || ''), margin + 5, y, { width: 240 });
          doc.text(String(qty), 300, y, { width: 40 });
          doc.text(nf.format(rate), 360, y, { width: 80 });
          doc.text(nf.format(line), 450, y, { width: 90 });
          doc.moveDown(0.2);
        });
        doc.moveDown();
      }

      // Totals panel (right aligned box)
      const taxRate = Number(inv.tax_rate || 0);
      const tax = subtotal * (taxRate / 100);
      const total = (Array.isArray(inv.items) && inv.items.length > 0) ? (subtotal + tax) : (Number(inv.amount || 0) / 100);
      const panelX = 330;
      const panelY = doc.y;
      const panelW = pageWidth - margin - panelX;
      doc.save();
      doc.roundedRect(panelX, panelY, panelW, 80, 6).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
      doc.fontSize(12).fillColor('#111').text('Summary', panelX + 10, panelY + 10);
      doc.fontSize(10).fillColor('#000').text(`Currency: ${currency}`, panelX + 10, panelY + 28);
      if (Array.isArray(inv.items) && inv.items.length > 0) {
        doc.text(`Subtotal: ${nf.format(subtotal)}`, panelX + 10, panelY + 42);
        doc.text(`Tax (${taxRate}%): ${nf.format(tax)}`, panelX + 10, panelY + 56);
      }
      doc.fontSize(12).fillColor('#0ea5e9').text(`Total: ${nf.format(total)}`, panelX + 10, panelY + 72 - 14);
      doc.restore();
      doc.moveDown(2);

      // Notes
      if (inv.notes) {
        doc.fontSize(12).text('Notes', { underline: true }).moveDown(0.3);
        doc.fontSize(10).fillColor('#444').text(inv.notes, { width: pageWidth - margin * 2 }).fillColor('#000').moveDown();
      }

      // Footer
      doc.moveTo(margin, doc.page.height - 60).lineTo(pageWidth - margin, doc.page.height - 60).strokeColor('#e5e7eb').stroke();
      doc.fontSize(9).fillColor('#666').text('Generated by Ledgr', margin, doc.page.height - 50, { align: 'center', width: pageWidth - margin * 2 }).fillColor('#000');

      doc.end();
    });

    // Upload to Supabase Storage (bucket: invoices)
    await ensureInvoiceBucket();
    await supabaseAdmin.storage.from('invoices').upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const shouldDownload = String((req.query as any)?.download ?? '1') === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${filename}"`);
    console.log(`[invoices] pdf ok user=${userId} id=${id} filename=${filename}`);
    return res.send(pdfBuffer);
  } catch (e: any) {
    console.error('[invoices] pdf threw', { userId, id, error: e });
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

// GET /api/invoices/:id/share -> generate or reuse stored PDF and return a signed URL
router.get('/:id/share', async (req, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    console.warn('[invoices] GET /:id/share unauthenticated (no user)');
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const { id } = req.params;
  if (!id) {
    console.warn('[invoices] share missing id');
    return res.status(400).json({ error: 'Missing invoice id' });
  }
  console.log(`[invoices] GET /${id}/share user=${userId}`);

  try {
    const { data: inv, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error) {
      console.warn('[invoices] share fetch failed', { userId, id, error: error.message });
      return res.status(500).json({ error: error.message });
    }
    if (!inv) {
      console.warn('[invoices] share not found', { userId, id });
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    const date = new Date(inv.created_at).toISOString().slice(0, 10);
    const filename = `invoice-${safe(inv.customer)}-${date}-${String(inv.id).slice(0,8)}.pdf`;
    const storagePath = `${userId}/${filename}`;

    await ensureInvoiceBucket();

    // Try to get existing object; if not present, generate by calling our own buffer generator via function
    const { data: stat } = await supabaseAdmin.storage.from('invoices').list(userId, { search: filename });
    if (!stat || stat.length === 0) {
      // Generate a styled PDF consistent with /:id/pdf
      const PDFDocument = require('pdfkit');
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const { data: profile } = await supabaseAdmin.from('profiles').select('name').eq('id', userId).single();
      const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const margin = 50;
        // Header
        doc.save();
        doc.rect(0, 0, pageWidth, 60).fill('#0ea5e9');
        doc.fill('#ffffff').fontSize(22).text('INVOICE', margin, 20, { align: 'left' });
        doc.fill('#ffffff').fontSize(12).text(profile?.name || 'Ledgr', margin, 22, { align: 'right', width: pageWidth - margin * 2 });
        doc.restore();
        doc.moveDown(1.5);

        // Meta
        doc.fontSize(10).fillColor('#444');
        doc.text(`Invoice ID: ${inv.id}`);
        doc.text(`Date: ${new Date(inv.created_at).toLocaleDateString()}`);
        doc.text(`Status: ${inv.status}`);
        doc.fillColor('#000').moveDown();

        // Bill To
        doc.fontSize(12).fillColor('#111').text('Bill To', margin, doc.y, { underline: true });
        doc.fontSize(11).fillColor('#000').text(inv.customer).moveDown();

        // Totals panel (minimal)
        const currency = String(inv.currency).toUpperCase();
        const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency });
        const amount = Number(inv.amount || 0) / 100;
        const panelX = 330;
        const panelY = doc.y;
        const panelW = pageWidth - margin - panelX;
        doc.save();
        doc.roundedRect(panelX, panelY, panelW, 60, 6).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
        doc.fontSize(12).fillColor('#111').text('Summary', panelX + 10, panelY + 10);
        doc.fontSize(10).fillColor('#000').text(`Currency: ${currency}`, panelX + 10, panelY + 28);
        doc.fontSize(12).fillColor('#0ea5e9').text(`Total: ${nf.format(amount)}`, panelX + 10, panelY + 44);
        doc.restore();
        doc.moveDown(2);

        // Footer
        doc.moveTo(margin, doc.page.height - 60).lineTo(pageWidth - margin, doc.page.height - 60).strokeColor('#e5e7eb').stroke();
        doc.fontSize(9).fillColor('#666').text('Generated by Ledgr', margin, doc.page.height - 50, { align: 'center', width: pageWidth - margin * 2 }).fillColor('#000');

        doc.end();
      });
      await supabaseAdmin.storage.from('invoices').upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('invoices')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days
    if (signErr) {
      console.warn('[invoices] share sign failed', { userId, id, error: signErr.message });
      return res.status(500).json({ error: signErr.message });
    }
    console.log(`[invoices] share ok user=${userId} id=${id}`);
    return res.json({ url: signed?.signedUrl });
  } catch (e: any) {
    console.error('[invoices] share threw', { userId, id, error: e });
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

async function ensureInvoiceBucket() {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const exists = (buckets || []).some(b => b.name === 'invoices');
    if (!exists) {
      await supabaseAdmin.storage.createBucket('invoices', { public: false });
    }
  } catch (e) {
    // ignore race conditions
  }
}
