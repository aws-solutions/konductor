export default function verbose(value) {
  const text = String(value);
  return `${text} [${text.length}]`;
}
