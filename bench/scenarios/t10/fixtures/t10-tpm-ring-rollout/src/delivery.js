'use strict';

function createDelivery(send = () => ({ accepted: true })) {
  return {
    deliver(document, destination) {
      return send({ document, destination });
    }
  };
}

module.exports = { createDelivery };
