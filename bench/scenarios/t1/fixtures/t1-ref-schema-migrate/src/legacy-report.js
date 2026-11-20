const { format } = require('node:util');
function customerLabel(customer) { return format('%s <%s>', customer.name, customer.email); }
module.exports = { customerLabel };
