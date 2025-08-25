import { Router } from 'express';
import { authMiddleware } from '../utils/authMiddleware';
import { supabaseAdmin } from '../lib/supabase';

export const router = Router();
router.use(authMiddleware as any);

// Ensure the user has a USD wallet; returns wallet id
async function ensureUsdWallet(userId: string): Promise<string> {
  // Select the earliest created USD wallet to avoid multiple-rows error if duplicates exist
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .eq('currency', 'USD')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readErr) throw readErr;
  if (existing?.id) return existing.id as string;
  const { data: created, error: createErr } = await supabaseAdmin
    .from('wallets')
    .insert({ user_id: userId, currency: 'USD', balance_cents: 0 })
    .select('id')
    .single();
  if (createErr) throw createErr;
  return created!.id as string;
}

// GET /api/wallets -> list balances (USD)
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    await ensureUsdWallet(user.id);
    const { data, error } = await supabaseAdmin
      .from('wallets')
      .select('id, currency, balance_cents, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ wallets: data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Failed to load wallets' });
  }
});

// GET /api/wallets/transactions -> list tx history
router.get('/transactions', async (req, res) => {
  try {
    const user = (req as any).user;
    const { data, error } = await supabaseAdmin
      .from('wallet_transactions')
      .select('id, wallet_id, type, amount_cents, reference, metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ transactions: data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Failed to load transactions' });
  }
});

export default router;
