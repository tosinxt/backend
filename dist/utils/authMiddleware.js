"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const supabase_1 = require("../lib/supabase");
// Verifies the Supabase JWT from the Authorization header and attaches user to req
async function authMiddleware(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token)
        return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const { data, error } = await supabase_1.supabaseAdmin.auth.getUser(token);
    if (error || !data?.user)
        return res.status(401).json({ error: 'Invalid or expired token' });
    // Attach minimal user info
    req.user = data.user;
    return next();
}
