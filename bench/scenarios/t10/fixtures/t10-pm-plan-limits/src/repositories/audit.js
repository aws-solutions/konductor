'use strict';
const { makeId } = require('../lib/ids');
function auditRepository(store) { return { append(event) { const data = store.read(); data.audit = data.audit || []; const row = {...event, id: makeId('audit'), at: new Date().toISOString()}; data.audit.push(row); store.write(data); return row; }, list() { return store.read().audit || []; } }; }
module.exports = { auditRepository };
