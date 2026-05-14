import { randomBytes } from "node:crypto";
import { decryptWithAesGcm, encryptWithAesGcm } from "@/lib/crypto";
import { AES_ENVELOPE_ALGORITHM } from "@/lib/types";

describe("AES-256-GCM envelope", () => {
  test("encrypts and decrypts with required schema", () => {
    const key = randomBytes(32);
    const plaintext = randomBytes(32);

    const envelope = encryptWithAesGcm(plaintext, key);

    expect(envelope.alg).toBe(AES_ENVELOPE_ALGORITHM);
    expect(Buffer.from(envelope.ivB64, "base64")).toHaveLength(12);
    expect(Buffer.from(envelope.tagB64, "base64")).toHaveLength(16);

    const decrypted = decryptWithAesGcm(envelope, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test("rejects unsupported envelope algorithm", () => {
    const key = randomBytes(32);
    const plaintext = randomBytes(32);
    const envelope = encryptWithAesGcm(plaintext, key);

    expect(() => decryptWithAesGcm({ ...envelope, alg: "OTHER" as never }, key)).toThrow("Unsupported AES envelope algorithm");
  });
});
