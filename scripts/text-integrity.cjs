// Test-only LF baseline hashing. Never rewrite a protected file or normalize other bytes.
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
function textHash(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  // Decode only to validate UTF-8; keep BOM and all other bytes in the digest.
  const crlf = input.toString('utf8').match(/\r\n/g) || [];
  const rest = input.toString('utf8').replace(/\r\n/g, '');
  if (rest.includes('\r') || (crlf.length && rest.includes('\n'))) throw Error('INVALID_OR_MIXED_NEWLINES');
  void text;
  return crypto.createHash('sha256').update(crlf.length ? Buffer.from(input.toString('utf8').replace(/\r\n/g, '\n')) : input).digest('hex');
}
function checkTextIntegrityNegatives() {
  const lf = Buffer.from('permission=required\ncoordinate=1\n');
  const expected = textHash(lf);
  assert.equal(textHash(lf.toString().replace(/\n/g, '\r\n')), expected);
  for (const changed of ['permission=optional\ncoordinate=1\n', 'permission=required\ncoordinate=2\n', 'permission=required \ncoordinate=1\n', '\ufeff'+lf.toString()]) assert.notEqual(textHash(changed), expected);
  for (const invalid of ['a\r\nb\n', 'a\rb', Buffer.from([0xff])]) assert.throws(()=>textHash(invalid));
}
module.exports = { textHash, checkTextIntegrityNegatives };
