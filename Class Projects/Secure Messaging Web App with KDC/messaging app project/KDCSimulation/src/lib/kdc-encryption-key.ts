import { getKdcEncryptionKeyKid, getKdcPrivateKeyPem, getKdcPublicKeyPem } from "@/lib/config";
import { KDC_ENCRYPTION_KEY_ALGORITHM, KDC_ENCRYPTION_KEY_USE } from "@/lib/types";

type WebCryptoKeyUsage = "encrypt" | "decrypt" | "sign" | "verify" | "deriveKey" | "deriveBits" | "wrapKey" | "unwrapKey";

let encryptionKeyValidated = false;

function pemToDerBytes(keyPem: string, fieldName: string): Uint8Array {
  const base64Body = keyPem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  if (!base64Body) {
    throw new Error(`${fieldName} must be a valid PEM encoded key`);
  }

  return Buffer.from(base64Body, "base64");
}

async function assertRsaOaepSha256KeyPem(keyPem: string, fieldName: string, format: "spki" | "pkcs8"): Promise<void> {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle) {
    throw new Error("WebCrypto is unavailable for key validation");
  }

  const algorithm = { name: "RSA-OAEP", hash: "SHA-256" } as const;
  const key = await webCrypto.subtle.importKey(
    format,
    pemToDerBytes(keyPem, fieldName),
    algorithm,
    true,
    format === "spki" ? (["encrypt"] as WebCryptoKeyUsage[]) : (["decrypt"] as WebCryptoKeyUsage[])
  );
  const jwk = await webCrypto.subtle.exportKey("jwk", key);

  if (!jwk || typeof jwk !== "object" || typeof jwk.n !== "string") {
    throw new Error(`${fieldName} must be an RSA key`);
  }
}

export async function ensureKdcEncryptionKeyConfigured(): Promise<void> {
  if (encryptionKeyValidated) {
    return;
  }

  await assertRsaOaepSha256KeyPem(getKdcPublicKeyPem(), "KDC_PUBLIC_KEY_PEM", "spki");
  await assertRsaOaepSha256KeyPem(getKdcPrivateKeyPem(), "KDC_PRIVATE_KEY_PEM", "pkcs8");

  encryptionKeyValidated = true;
}

export function getKdcEncryptionPublicKeyPem(): string {
  return getKdcPublicKeyPem();
}

export async function getKdcEncryptionPublicKeyMetadata(): Promise<{
  algorithm: typeof KDC_ENCRYPTION_KEY_ALGORITHM;
  use: typeof KDC_ENCRYPTION_KEY_USE;
  kid: string;
  publicKeyPem: string;
}> {
  await ensureKdcEncryptionKeyConfigured();

  return {
    algorithm: KDC_ENCRYPTION_KEY_ALGORITHM,
    use: KDC_ENCRYPTION_KEY_USE,
    kid: getKdcEncryptionKeyKid(),
    publicKeyPem: getKdcEncryptionPublicKeyPem()
  };
}