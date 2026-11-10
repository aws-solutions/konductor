'use strict';

const express = require('express');
const { requireAuth } = require('./middleware/auth');
const apiRouter = require('./routes/api');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/api', requireAuth, apiRouter);

module.exports = app;
