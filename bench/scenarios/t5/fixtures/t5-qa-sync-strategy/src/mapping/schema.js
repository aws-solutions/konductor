const required = ['id', 'email'];
function validateCustomer(row) { return required.every(key => row[key] !== undefined && row[key] !== ''); }
module.exports = { required, validateCustomer };
