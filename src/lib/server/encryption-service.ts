import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  encryptionVersion: 1;
}

function encryptionKey(environment: Record<string, string | undefined> = process.env) {
  const configured = environment.CLARIFT_BYOK_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error('BYOK encryption is not configured.');
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) throw new Error('BYOK encryption key must decode to exactly 32 bytes.');
  return key;
}

export function encryptSecret(value: string, associatedData: string, environment?: Record<string, string | undefined>): EncryptedSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(environment), nonce);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    encryptionVersion: 1,
  };
}

export function decryptSecret(secret: EncryptedSecret, associatedData: string, environment?: Record<string, string | undefined>) {
  if (secret.encryptionVersion !== 1) throw new Error('Unsupported provider-key encryption version.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(environment), Buffer.from(secret.nonce, 'base64'));
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
