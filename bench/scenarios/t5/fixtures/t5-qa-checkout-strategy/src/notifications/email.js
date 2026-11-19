async function sendReceipt(mailer, order, logger = console) {
  try {
    await mailer.send({
      to: order.email,
      subject: `Receipt ${order.id}`,
      text: `Thank you for order ${order.id}. Total: ${order.total}`
    });
    return { sent: true };
  } catch (error) {
    return { sent: false };
  }
}

module.exports = { sendReceipt };
