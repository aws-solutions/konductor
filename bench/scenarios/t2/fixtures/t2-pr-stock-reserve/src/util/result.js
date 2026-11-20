export const ok = (value) => ({ ok: true, value });
export const failure = (code, message) => ({ ok: false, error: { code, message } });

export function unwrap(result) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
