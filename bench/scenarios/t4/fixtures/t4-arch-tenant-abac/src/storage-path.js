"use strict";

function documentKey(tenantId, documentName) { return `tenants/${tenantId}/${documentName}`; }
function exportKey(tenantId, name) { return `exports/${tenantId}/${name}`; }
function metadataKey(tenantId) { return { tenantId }; }

module.exports = { documentKey, exportKey, metadataKey };
