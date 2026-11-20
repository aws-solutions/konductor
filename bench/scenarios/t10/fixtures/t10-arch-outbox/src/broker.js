'use strict';
class InProcessBroker { constructor(options={}){this.messages=[];this.maxBytes=options.maxBytes ?? 2048;this.publishImpl=options.publish;} publish(topic,message){ const bytes=Buffer.byteLength(JSON.stringify({topic,message})); if(bytes>this.maxBytes){const e=new Error('message exceeds broker limit');e.code='BROKER_MESSAGE_TOO_LARGE';throw e;} if(this.publishImpl)return this.publishImpl(topic,message); this.messages.push({topic,message}); return {accepted:true}; } }
module.exports={InProcessBroker};
