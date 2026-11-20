export default function compact(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}
