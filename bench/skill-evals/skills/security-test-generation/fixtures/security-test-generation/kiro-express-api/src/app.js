const express = require('express');
const { authenticate } = require('./middleware/auth');
const users = require('./routes/users');
const search = require('./routes/search');
const admin = require('./routes/admin');
const uploads = require('./routes/uploads');
const login = require('./routes/login');

const app = express();
app.use(express.json());
app.use('/login', login);
app.use('/users', authenticate, users);
app.use('/search', authenticate, search);
app.use('/admin', authenticate, admin);
app.use('/uploads', authenticate, uploads);

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message, stack: err.stack });
});

module.exports = app;
if (require.main === module) app.listen(3000);
