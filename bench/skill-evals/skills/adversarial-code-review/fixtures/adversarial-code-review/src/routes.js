'use strict';

const express = require('express');
const { authorize } = require('./lib/auth');
const accounts = require('./handlers/accounts');
const transfers = require('./handlers/transfers');

const router = express.Router();

router.get('/accounts/:accountId', authorize, accounts.get);
router.post('/accounts', authorize, accounts.create);
router.post('/transfers', transfers.create);
router.get('/accounts/:accountId/transfers', authorize, transfers.list);

module.exports = { router };
