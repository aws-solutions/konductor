function parseCouponCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const [code, kind, amount, expires] = line.split(',');
    return { code, kind, amount: Number(amount), expires: new Date(expires) };
  });
}

module.exports = { parseCouponCsv };
