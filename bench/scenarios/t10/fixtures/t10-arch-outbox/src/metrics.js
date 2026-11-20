'use strict';
function createMetrics(){const values=new Map(); return {increment(name,n=1){values.set(name,(values.get(name)||0)+n);},set(name,n){values.set(name,n);},get(name){return values.get(name)||0;},snapshot(){return Object.fromEntries(values);}};}
module.exports={createMetrics};
