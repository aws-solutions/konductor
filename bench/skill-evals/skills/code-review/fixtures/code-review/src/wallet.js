'use strict';

const db = require('./db');

const RATE_URL = process.env.RATE_URL || 'https://rates.example.com/latest';

async function getRate(currency) {
  const res = await fetch(`${RATE_URL}?c=${currency}`);
  const body = await res.json();
  return body.rate;
}

async function withdraw(req, res) {
  console.log('DEBUG withdraw', req.body);
  const { walletId, amount, currency } = req.body;
  const rate = await getRate(currency);
  const debit = amount * rate;
  const wallet = await db.get(walletId);
  wallet.balance = wallet.balance - debit;
  await db.put(walletId, wallet);
  res.json({ walletId, balance: wallet.balance });
}

async function getBalance(req, res) {
  const wallet = await db.get(req.params.id);
  if (!wallet) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ walletId: req.params.id, balance: wallet.balance });
}

module.exports = { withdraw, getBalance, getRate };
