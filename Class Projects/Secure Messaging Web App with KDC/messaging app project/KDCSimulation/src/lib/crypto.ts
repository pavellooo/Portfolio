import { constants, createCipheriv, createDecipheriv, privateDecrypt, randomBytes } from "node:crypto";
import { getKdcPrivateKeyPem } from "@/lib/config";
import { getKdcEncryptionPublicKeyPem } from "@/lib/kdc-encryption-key";
import { decodeBase64ExactLength, decodeBase64Strict, toBase64 } from "@/lib/encoding";
import { badRequest } from "@/lib/errors";
import { AES_ENVELOPE_ALGORITHM, type AesGcmEnvelope } from "@/lib/types";

const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;
const AES_AUTH_TAG_BYTES = 16;

export function getPublicKeyPem(): string {
  return getKdcEncryptionPublicKeyPem();
}

export function getKdcEncryptionPublicKeyPemSafe(): string {
  return getKdcEncryptionPublicKeyPem();
}

export function decryptRegisteredUserKey(encryptedUserKeyBase64: string): Buffer {
  try {
    const ciphertext = decodeBase64Strict(encryptedUserKeyBase64, "encryptedUserKey");

    const plaintext = privateDecrypt(
      {
        key: getKdcPrivateKeyPem(),
        oaepHash: "sha256",
        padding: constants.RSA_PKCS1_OAEP_PADDING
      },
      ciphertext
    );

    if (plaintext.length !== AES_KEY_BYTES) {
      badRequest("Decrypted user key must be 32 bytes");
    }

    return plaintext;
  } catch {
    badRequest("Unable to decrypt encryptedUserKey with KDC private key");
  }
}

export function generateSessionKey(): Buffer {
  return randomBytes(AES_KEY_BYTES);
}

export function encryptWithAesGcm(plaintext: Buffer, key: Buffer): AesGcmEnvelope {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error("AES key must be 32 bytes");
  }

  const iv = randomBytes(AES_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AES_AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    alg: AES_ENVELOPE_ALGORITHM,
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(ciphertext),
    tagB64: toBase64(authTag)
  };
}

export function decryptWithAesGcm(envelope: AesGcmEnvelope, key: Buffer): Buffer {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error("AES key must be 32 bytes");
  }

  if (envelope.alg !== AES_ENVELOPE_ALGORITHM) {
    throw new Error("Unsupported AES envelope algorithm");
  }

  const iv = decodeBase64ExactLength(envelope.ivB64, AES_IV_BYTES, "ivB64");
  const authTag = decodeBase64ExactLength(envelope.tagB64, AES_AUTH_TAG_BYTES, "tagB64");
  const ciphertext = decodeBase64Strict(envelope.ciphertextB64, "ciphertextB64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AES_AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
