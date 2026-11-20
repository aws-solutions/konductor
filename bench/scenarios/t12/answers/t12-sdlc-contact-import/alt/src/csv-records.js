'use strict';

// Reads CSV text (RFC 4180: quoted fields, doubled quotes, CR, LF or CRLF line ends, line breaks inside quotes) as a
// stream of records. Each record knows the file line it starts on, counting the first line as 1, because support
// quotes those numbers to customers.

const STATE = { FIELD_START: 0, PLAIN: 1, QUOTED: 2, QUOTE_IN_QUOTED: 3 };

function* records(text) {
  let state = STATE.FIELD_START;
  let fields = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  const endField = () => { fields.push(buf); buf = ''; };
  const endRecord = function* () {
    endField();
    if (fields.some((f) => f.trim() !== '')) yield { line: startLine, fields };
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const newline = ch === '\n' || ch === '\r';
    if (newline && ch === '\r' && text[i + 1] === '\n') i++;
    if (state === STATE.QUOTED) {
      if (ch === '"') state = STATE.QUOTE_IN_QUOTED;
      else { buf += newline ? '\n' : ch; if (newline) line++; }
      continue;
    }
    if (state === STATE.QUOTE_IN_QUOTED && ch === '"') { buf += '"'; state = STATE.QUOTED; continue; }
    if (ch === '"' && state === STATE.FIELD_START) { state = STATE.QUOTED; continue; }
    if (ch === ',') { endField(); state = STATE.FIELD_START; continue; }
    if (newline) {
      yield* endRecord();
      line++;
      startLine = line;
      state = STATE.FIELD_START;
      continue;
    }
    buf += ch;
    state = STATE.PLAIN;
  }
  if (buf !== '' || fields.length) yield* endRecord();
}

module.exports = { records };
