import { Router } from 'express';
import { authMiddleware } from '../utils/authMiddleware';
import { supabaseAdmin } from '../lib/supabase';

export const router = Router();
router.use(authMiddleware as any);

async function ensureUsdWallet(userId: string): Promise<{ id: string; balance_cents: number }> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('wallets')
    .select('id, balance_cents')
    .eq('user_id', userId)
    .eq('currency', 'USD')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readErr) throw readErr;
  if (existing?.id) return { id: existing.id as string, balance_cents: existing.balance_cents as number };
  const { data: created, error: createErr } = await supabaseAdmin
    .from('wallets')
    .insert({ user_id: userId, currency: 'USD', balance_cents: 0 })
    .select('id, balance_cents')
    .single();
  if (createErr) throw createErr;
  return { id: created!.id as string, balance_cents: created!.balance_cents as number };
}

// GET /api/crypto/intents -> list
router.get('/intents', async (req, res) => {
  try {
    const user = (req as any).user;
    const { data, error } = await supabaseAdmin
      .from('payment_intents')
      .select('id, invoice_id, amount_cents, currency, status, provider, provider_ref, created_at, confirmed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ intents: data });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list intents' });
  }
});

// GET /api/crypto/intents/:id -> fetch single intent (for mock checkout)
router.get('/intents/:id', async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const { data, error } = await supabaseAdmin
      .from('payment_intents')
      .select('id, invoice_id, amount_cents, currency, status, provider, provider_ref, created_at, confirmed_at')
      .eq('user_id', user.id)
      .eq('id', id)
      .single();
    if (error) return res.status(404).json({ error: 'Intent not found' });
    res.json({ intent: data });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to fetch intent' });
  }
});

// POST /api/crypto/intents -> create a new mock intent
// body: { amount_cents: number, invoice_id?: string }
router.post('/intents', async (req, res) => {
  try {
    const user = (req as any).user;
    const { amount_cents, invoice_id } = req.body || {};
    if (!amount_cents || typeof amount_cents !== 'number' || amount_cents <= 0) {
      return res.status(400).json({ error: 'amount_cents must be a positive number' });
    }
    await ensureUsdWallet(user.id);
    const provider_ref = `mock_${Math.random().toString(36).slice(2, 10)}`;
    const { data, error } = await supabaseAdmin
      .from('payment_intents')
      .insert({ user_id: user.id, amount_cents, currency: 'USD', invoice_id: invoice_id || null, provider: 'mock', provider_ref })
      .select('id, invoice_id, amount_cents, currency, status, provider, provider_ref, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    // Mock hosted URL for demo purposes
    const checkout_url = `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/mock/checkout/${data!.id}`;
    res.json({ intent: data, checkout_url });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to create intent' });
  }
});

// POST /api/crypto/mock/confirm -> simulates provider confirming a payment
// body: { intent_id: string }
router.post('/mock/confirm', async (req, res) => {
  try {
    const user = (req as any).user;
    const { intent_id } = req.body || {};
    if (!intent_id) return res.status(400).json({ error: 'intent_id required' });

    // Load intent
    const { data: intent, error: intentErr } = await supabaseAdmin
      .from('payment_intents')
      .select('*')
      .eq('id', intent_id)
      .eq('user_id', user.id)
      .single();
    if (intentErr) return res.status(404).json({ error: 'Intent not found' });
    if (intent.status === 'confirmed') {
      return res.json({ ok: true, intent });
    }
    if (intent.status !== 'pending') {
      return res.status(400).json({ error: `Cannot confirm intent in status ${intent.status}` });
    }

    // Credit wallet
    const { id: walletId } = await ensureUsdWallet(user.id);

    const { error: txErr } = await supabaseAdmin.from('wallet_transactions').insert({
      user_id: user.id,
      wallet_id: walletId,
      type: 'credit',
      amount_cents: intent.amount_cents,
      reference: `intent:${intent.id}`,
      metadata: { provider: intent.provider, provider_ref: intent.provider_ref },
    });
    if (txErr) return res.status(500).json({ error: txErr.message });

    // Atomic increment of wallet balance
    const { error: incrErr } = await supabaseAdmin.rpc('increment_wallet_balance', {
      p_wallet_id: walletId,
      p_amount: intent.amount_cents,
    });
    if (incrErr) return res.status(500).json({ error: incrErr.message });

    // Update intent and optionally invoice
    const { data: updated, error: updIntentErr } = await supabaseAdmin
      .from('payment_intents')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('id', intent.id)
      .select('*')
      .single();
    if (updIntentErr) return res.status(500).json({ error: updIntentErr.message });

    if (intent.invoice_id) {
      await supabaseAdmin
        .from('invoices')
        .update({ status: 'paid' })
        .eq('id', intent.invoice_id)
        .eq('user_id', user.id);
    }

    res.json({ ok: true, intent: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to confirm intent' });
  }
});

export default router;
