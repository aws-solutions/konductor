'use strict';

const express = require('express');
const { authorize } = require('./lib/auth');
const { validate } = require('./lib/validate');
const { orderInput } = require('./schema');
const orders = require('./handlers/orders');

const router = express.Router();

router.post('/v1/orders', authorize, validate(orderInput), orders.create);
router.get('/v1/orders/:id', authorize, orders.get);
router.post('/v1/orders/:id/cancel', authorize, orders.cancel);

module.exports = { router };
