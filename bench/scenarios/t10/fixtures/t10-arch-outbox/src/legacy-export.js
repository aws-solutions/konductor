'use strict';
function csvEscape(value){return '"'+String(value).replaceAll('"','""')+'"';}
function exportOrders(orders){return ['id,externalReference,paymentStatus',...orders.map(o=>[o.id,o.externalReference,o.paymentStatus].map(csvEscape).join(','))].join('\n');}
module.exports={exportOrders};
