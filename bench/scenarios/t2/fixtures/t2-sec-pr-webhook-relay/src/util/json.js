export function parseJson(text) {
  try { return { value: JSON.parse(text), error: null }; }
  catch (error) { return { value: null, error }; }
}
