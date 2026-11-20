'use strict';
function mailer(send) { return { notify(address, body) { return send({ address, body }); } }; }
module.exports = { mailer };
