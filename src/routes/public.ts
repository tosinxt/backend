import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { createHmac } from 'crypto';

export const router = Router();

function getSecret(): string {
  const secret = process.env.PUBLIC_SHARE_SECRET;
  if (!secret) throw new Error('PUBLIC_SHARE_SECRET is not set');
  return secret;
}

function makeToken(userId: string, invoiceId: string): string {
  const h = createHmac('sha256', getSecret());
  h.update(`${userId}:${invoiceId}`);
  return h.digest('hex');
}

// GET /api/public/invoices/:id?token=...
// Returns a read-only view of an invoice if the token matches
router.get('/invoices/:id', async (req, res) => {
  const { id } = req.params;
  const { token } = req.query as { token?: string };
  if (!id || !token) return res.status(400).json({ error: 'Missing id or token' });
  try {
    const { data: inv, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const expected = makeToken(String(inv.user_id), String(inv.id));
    if (token !== expected) return res.status(403).json({ error: 'Invalid token' });

    // Return a subset of fields (read-only)
    const {
      id: invoice_id,
      created_at,
      status,
      amount,
      currency,
      customer,
      items,
      tax_rate,
      notes,
      company_name,
      company_address,
      client_email,
      client_address,
      issue_date,
      due_date,
      template_kind,
    } = inv as any;

    return res.json({
      id: invoice_id,
      created_at,
      status,
      amount,
      currency,
      customer,
      items,
      tax_rate,
      notes,
      company_name,
      company_address,
      client_email,
      client_address,
      issue_date,
      due_date,
      template_kind,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
});

export default router;
