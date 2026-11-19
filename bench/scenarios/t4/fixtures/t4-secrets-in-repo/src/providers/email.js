function createEmailProvider({ transport } = {}) {
  const sendTransport = transport || (() => ({ accepted: true }));
  return {
    send(to, subject, body) {
      return sendTransport({ to, subject, body });
    }
  };
}

module.exports = { createEmailProvider };
