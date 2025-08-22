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
// GET /api/invoices -> list invoices
exports.router.get('/', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const { data, error } = await supabase_1.supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ invoices: data });
});
// POST /api/invoices -> create invoice
exports.router.post('/', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const ItemSchema = zod_1.z.object({ description: zod_1.z.string().min(1), quantity: zod_1.z.number().positive(), rate: zod_1.z.number().nonnegative(), amount: zod_1.z.number().nonnegative().optional() });
    const CreateInvoiceSchema = zod_1.z.object({
        // If items provided, server will compute amount
        amount: zod_1.z.number().int().positive().optional(),
        currency: zod_1.z.string().min(3).max(10),
        customer: zod_1.z.string().min(1).max(120),
        items: zod_1.z.array(ItemSchema).optional(),
        tax_rate: zod_1.z.number().nonnegative().max(100).optional(),
        notes: zod_1.z.string().optional(),
        company_name: zod_1.z.string().optional(),
        company_address: zod_1.z.string().optional(),
        client_email: zod_1.z.string().email().optional(),
        client_address: zod_1.z.string().optional(),
        issue_date: zod_1.z.string().optional(),
        due_date: zod_1.z.string().optional(),
    });
    const parsed = CreateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
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
        return res.status(400).json({ error: 'Invalid amount. Provide positive amount or valid items/tax_rate.' });
    }
    const payload = {
        user_id: userId,
        amount,
        currency,
        customer,
        status: 'pending',
        items: items.length > 0 ? items.map(it => ({ description: it.description, quantity: it.quantity, rate: it.rate })) : null,
        tax_rate: items.length > 0 ? taxRate : null,
        notes: parsed.data.notes ?? null,
        company_name: parsed.data.company_name ?? null,
        company_address: parsed.data.company_address ?? null,
        client_email: parsed.data.client_email ?? null,
        client_address: parsed.data.client_address ?? null,
        issue_date: parsed.data.issue_date ? new Date(parsed.data.issue_date) : null,
        due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null,
    };
    try {
        const { data, error } = await supabase_1.supabaseAdmin.from('invoices').insert(payload).select('*').single();
        if (error) {
            console.error('Create invoice failed', { userId, payload, error });
            return res.status(500).json({ error: error.message });
        }
        return res.status(201).json(data);
    }
    catch (e) {
        console.error('Create invoice threw', { userId, payload, error: e });
        return res.status(500).json({ error: e?.message || 'Internal Server Error' });
    }
});
// POST /api/invoices/:id/pay -> mark paid
exports.router.post('/:id/pay', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ error: 'Missing invoice id' });
    try {
        const { data, error } = await supabase_1.supabaseAdmin
            .from('invoices')
            .update({ status: 'paid' })
            .eq('id', id)
            .eq('user_id', userId)
            .select('*')
            .single();
        if (error) {
            console.error('Mark paid failed', { userId, id, error });
            return res.status(500).json({ error: error.message });
        }
        if (!data)
            return res.status(404).json({ error: 'Invoice not found' });
        return res.json(data);
    }
    catch (e) {
        console.error('Mark paid threw', { userId, id, error: e });
        return res.status(500).json({ error: e?.message || 'Internal Server Error' });
    }
});
// GET /api/invoices/:id/pdf -> download invoice as PDF
exports.router.get('/:id/pdf', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ error: 'Missing invoice id' });
    try {
        const { data: inv, error } = await supabase_1.supabaseAdmin
            .from('invoices')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();
        if (error) {
            console.error('Fetch invoice for PDF failed', { userId, id, error });
            return res.status(500).json({ error: error.message });
        }
        if (!inv) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        // Fetch profile for branding (name)
        const { data: profile } = await supabase_1.supabaseAdmin
            .from('profiles')
            .select('name')
            .eq('id', userId)
            .single();
        // Build a pretty, deterministic filename
        const safe = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
        const date = new Date(inv.created_at).toISOString().slice(0, 10);
        const filename = `invoice-${safe(inv.customer)}-${date}-${String(inv.id).slice(0, 8)}.pdf`;
        const storagePath = `${userId}/${filename}`;
        // Create PDF into a buffer so we can both return it and upload to storage
        // Lazy require to avoid TS type friction
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks = [];
        const pdfBuffer = await new Promise((resolve, reject) => {
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            // Header with branding
            doc
                .fontSize(22)
                .text(profile?.name || 'Ledgr', { align: 'right' })
                .moveDown(1);
            doc
                .fontSize(24)
                .text('INVOICE', { align: 'left' })
                .moveDown(0.5);
            // Meta
            doc
                .fontSize(10)
                .text(`Invoice ID: ${inv.id}`)
                .text(`Date: ${new Date(inv.created_at).toLocaleDateString()}`)
                .text(`Status: ${inv.status}`)
                .moveDown();
            // Company / Client info side-by-side
            doc.fontSize(12).text('From:', { underline: true });
            doc.fontSize(11).text(inv.company_name || (profile?.name || 'Ledgr'));
            if (inv.company_address)
                doc.fontSize(10).fillColor('#444').text(inv.company_address).fillColor('#000');
            doc.moveDown(0.5);
            doc.fontSize(12).text('Bill To:', { underline: true });
            doc.fontSize(11).text(inv.customer);
            if (inv.client_email)
                doc.fontSize(10).fillColor('#444').text(inv.client_email).fillColor('#000');
            if (inv.client_address)
                doc.fontSize(10).fillColor('#444').text(inv.client_address).fillColor('#000');
            doc.moveDown();
            // Dates
            if (inv.issue_date || inv.due_date) {
                doc.fontSize(12).text('Dates', { underline: true }).moveDown(0.2);
                doc.fontSize(11);
                if (inv.issue_date)
                    doc.text(`Issue Date: ${new Date(inv.issue_date).toLocaleDateString()}`);
                if (inv.due_date)
                    doc.text(`Due Date: ${new Date(inv.due_date).toLocaleDateString()}`);
                doc.moveDown();
            }
            // Itemized lines
            const currency = String(inv.currency).toUpperCase();
            const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency });
            let subtotal = 0;
            if (Array.isArray(inv.items) && inv.items.length > 0) {
                doc.fontSize(12).text('Items', { underline: true }).moveDown(0.5);
                // Table headers
                doc.fontSize(10).text('Description', 50, doc.y, { continued: true });
                doc.text('Qty', 300, doc.y, { continued: true });
                doc.text('Rate', 360, doc.y, { continued: true });
                doc.text('Amount', 430);
                doc.moveTo(50, doc.y + 2).lineTo(550, doc.y + 2).strokeColor('#ddd').stroke().strokeColor('#000');
                doc.moveDown(0.3);
                inv.items.forEach((it) => {
                    const qty = Number(it.quantity || 0);
                    const rate = Number(it.rate || 0);
                    const line = qty * rate;
                    subtotal += line;
                    const y = doc.y;
                    doc.fontSize(10).text(String(it.description || ''), 50, y, { width: 240, continued: true });
                    doc.text(String(qty), 300, y, { width: 40, continued: true });
                    doc.text(nf.format(rate), 360, y, { width: 60, continued: true });
                    doc.text(nf.format(line), 430, y, { width: 80 });
                    doc.moveDown(0.2);
                });
                doc.moveDown();
            }
            // Totals
            const taxRate = Number(inv.tax_rate || 0);
            const tax = subtotal * (taxRate / 100);
            const total = (Array.isArray(inv.items) && inv.items.length > 0) ? (subtotal + tax) : (Number(inv.amount || 0) / 100);
            doc.fontSize(12).text('Summary', { underline: true }).moveDown(0.5);
            doc.fontSize(11).text(`Currency: ${currency}`);
            if (Array.isArray(inv.items) && inv.items.length > 0) {
                doc.text(`Subtotal: ${nf.format(subtotal)}`);
                doc.text(`Tax (${taxRate}%): ${nf.format(tax)}`);
            }
            doc.text(`Total Amount: ${nf.format(total)}`).moveDown(1);
            // Notes
            if (inv.notes) {
                doc.fontSize(12).text('Notes', { underline: true }).moveDown(0.3);
                doc.fontSize(10).fillColor('#444').text(inv.notes, { width: 500 }).fillColor('#000').moveDown();
            }
            doc
                .fontSize(9)
                .fillColor('#666')
                .text('Generated by Ledgr', { align: 'center' })
                .fillColor('#000');
            doc.end();
        });
        // Upload to Supabase Storage (bucket: invoices)
        await ensureInvoiceBucket();
        await supabase_1.supabaseAdmin.storage.from('invoices').upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
        });
        const shouldDownload = String(req.query?.download ?? '1') === '1';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${filename}"`);
        return res.send(pdfBuffer);
    }
    catch (e) {
        console.error('PDF generation threw', { userId, id, error: e });
        return res.status(500).json({ error: e?.message || 'Internal Server Error' });
    }
});
// GET /api/invoices/:id/share -> generate or reuse stored PDF and return a signed URL
exports.router.get('/:id/share', async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthenticated' });
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ error: 'Missing invoice id' });
    try {
        const { data: inv, error } = await supabase_1.supabaseAdmin
            .from('invoices')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();
        if (error)
            return res.status(500).json({ error: error.message });
        if (!inv)
            return res.status(404).json({ error: 'Invoice not found' });
        const safe = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
        const date = new Date(inv.created_at).toISOString().slice(0, 10);
        const filename = `invoice-${safe(inv.customer)}-${date}-${String(inv.id).slice(0, 8)}.pdf`;
        const storagePath = `${userId}/${filename}`;
        await ensureInvoiceBucket();
        // Try to get existing object; if not present, generate by calling our own buffer generator via function
        const { data: stat } = await supabase_1.supabaseAdmin.storage.from('invoices').list(userId, { search: filename });
        if (!stat || stat.length === 0) {
            // Generate by fetching the PDF endpoint inline to force creation
            const shouldDownload = '0';
            // Reuse code path by calling current server indirectly is complex; instead, re-generate locally similar to above
            // Lazy require
            const PDFDocument = require('pdfkit');
            const chunks = [];
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const { data: profile } = await supabase_1.supabaseAdmin.from('profiles').select('name').eq('id', userId).single();
            const pdfBuffer = await new Promise((resolve, reject) => {
                doc.on('data', (c) => chunks.push(c));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);
                doc.fontSize(22).text(profile?.name || 'Ledgr', { align: 'right' }).moveDown(1);
                doc.fontSize(24).text('INVOICE', { align: 'left' }).moveDown(0.5);
                doc.fontSize(10).text(`Invoice ID: ${inv.id}`).text(`Date: ${new Date(inv.created_at).toLocaleDateString()}`).text(`Status: ${inv.status}`).moveDown();
                doc.fontSize(12).text('Bill To:', { underline: true }).fontSize(11).text(inv.customer).moveDown();
                const amount = Number(inv.amount || 0) / 100;
                const currency = String(inv.currency).toUpperCase();
                const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency });
                doc.fontSize(12).text('Summary', { underline: true }).moveDown(0.5).fontSize(11).text(`Currency: ${currency}`).text(`Total Amount: ${nf.format(amount)}`).moveDown(2);
                doc.fontSize(9).fillColor('#666').text('Generated by Ledgr', { align: 'center' }).fillColor('#000');
                doc.end();
            });
            await supabase_1.supabaseAdmin.storage.from('invoices').upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
        }
        const { data: signed, error: signErr } = await supabase_1.supabaseAdmin.storage
            .from('invoices')
            .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days
        if (signErr)
            return res.status(500).json({ error: signErr.message });
        return res.json({ url: signed?.signedUrl });
    }
    catch (e) {
        console.error('Share link error', { userId, id, error: e });
        return res.status(500).json({ error: e?.message || 'Internal Server Error' });
    }
});
async function ensureInvoiceBucket() {
    try {
        const { data: buckets } = await supabase_1.supabaseAdmin.storage.listBuckets();
        const exists = (buckets || []).some(b => b.name === 'invoices');
        if (!exists) {
            await supabase_1.supabaseAdmin.storage.createBucket('invoices', { public: false });
        }
    }
    catch (e) {
        // ignore race conditions
    }
}
