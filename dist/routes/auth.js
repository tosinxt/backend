"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
exports.router = (0, express_1.Router)();
exports.router.post('/login', (req, res) => {
    const { email } = req.body;
    // Mock user
    const user = {
        id: '1',
        email,
        name: email?.split('@')[0] || 'user',
        plan: 'free',
    };
    res.json({ token: 'mock-token', user });
});
exports.router.post('/register', (req, res) => {
    const { email, name } = req.body;
    const user = {
        id: '1',
        email,
        name: name || email?.split('@')[0] || 'user',
        plan: 'free',
    };
    res.json({ token: 'mock-token', user });
});
exports.router.post('/logout', (_req, res) => {
    res.json({ ok: true });
});
