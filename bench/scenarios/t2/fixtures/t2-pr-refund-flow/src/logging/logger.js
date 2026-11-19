export function logger(output = console) {
  return {
    info(event, fields = {}) { output.info(JSON.stringify({ level: 'info', event, ...fields })); },
    error(event, fields = {}) { output.error(JSON.stringify({ level: 'error', event, ...fields })); }
  };
}
