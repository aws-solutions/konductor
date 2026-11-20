function titleCase(value) {
  return String(value).trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function memberSummary(count) {
  const amount = Number(count);
  return `${amount} ${amount === 1 ? 'member' : 'members'}`;
}

module.exports = { titleCase, memberSummary };
