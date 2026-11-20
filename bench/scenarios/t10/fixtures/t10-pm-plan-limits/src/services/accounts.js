'use strict';
const { ok, fail } = require('../lib/result');
function accountService(accounts) { return { create(input) { if (!input || typeof input.name !== 'string' || !input.name.trim()) return fail('invalid_account', 'name is required'); return ok(accounts.create(input)); }, get(id) { const account = accounts.get(id); return account ? ok(account) : fail('account_not_found', 'account not found'); } }; }
module.exports = { accountService };
