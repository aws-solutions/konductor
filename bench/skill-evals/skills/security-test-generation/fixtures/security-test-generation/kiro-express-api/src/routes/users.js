const router = require('express').Router();
const db = require('../db');

// Returns profile, email and billing address for the requested user.
router.get('/:id', async (req, res) => {
  const user = await db.getUser(req.params.id);
  res.json(user);
});

module.exports = router;
