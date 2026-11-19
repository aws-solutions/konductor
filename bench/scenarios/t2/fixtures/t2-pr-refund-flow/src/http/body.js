export async function readJson(request) {
  let text = '';
  for await (const chunk of request) text += chunk;
  if (!text) return {};
  return JSON.parse(text);
}
