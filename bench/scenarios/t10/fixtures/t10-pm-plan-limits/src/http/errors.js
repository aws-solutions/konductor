'use strict';
function statusFor(code) { return ({ account_not_found: 404, project_not_found: 404, invalid_account: 400, invalid_project: 400, project_name_taken: 409 })[code] || 500; }
module.exports = { statusFor };
