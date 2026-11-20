'use strict';
function statusFor(code) { return ({ account_not_found: 404, project_not_found: 404, invalid_account: 400, invalid_project: 400, invalid_project_limit: 400, project_name_taken: 409, project_limit_reached: 409 })[code] || 500; }
module.exports = { statusFor };
