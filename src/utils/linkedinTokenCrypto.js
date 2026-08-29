const crypto = require('crypto');

// AES-256-GCM encryption for LinkedIn access tokens at rest. Key comes from
// LINKEDIN_TOKEN_ENCRYPTION_KEY (32 raw bytes, base64-encoded) — never
// hard-coded, never logged. Encrypted blobs are stored as
// "iv:authTag:ciphertext" (all base64) so they round-trip through a single
// String field. Mirrors utils/metaTokenCrypto.js exactly — same scheme,
// different env var, so a LinkedIn token compromise never also exposes Meta
// tokens (and vice versa) even if one key ever leaked.

function getKey() {
  const raw = process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('LINKEDIN_TOKEN_ENCRYPTION_KEY is not set — cannot encrypt/decrypt LinkedIn tokens.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('LINKEDIN_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).');
  }
  return key;
}

function encrypt(plainText) {
  if (!plainText) return plainText;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decrypt(blob) {
  if (!blob) return blob;
  const [ivB64, tagB64, dataB64] = blob.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted token blob.');
  }
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
