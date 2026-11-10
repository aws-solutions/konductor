const express = require('express');
const auth = require('./services/auth');
const payment = require('./services/payment');
const app = express();
app.use(express.json());
app.post('/login', async (req, res) => {
  try { res.json({ token: await auth.login(req.body.email, req.body.password) }); }
  catch (e) { res.status(e.message === 'LOCKED' ? 423 : 401).json({ error: e.message }); }
});
app.post('/password-reset', async (req, res) => { await auth.requestReset(req.body.email); res.status(202).end(); });
app.post('/password-reset/confirm', async (req, res) => {
  try { await auth.resetPassword(req.body.token, req.body.password); res.status(204).end(); }
  catch (e) { res.status(e.message === 'EXPIRED_TOKEN' ? 410 : 400).json({ error: e.message }); }
});
app.post('/checkout', async (req, res) => {
  try { res.status(201).json(await payment.checkout(req.body.userId, req.body.cart, req.body.paymentMethodId)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
module.exports = app;
