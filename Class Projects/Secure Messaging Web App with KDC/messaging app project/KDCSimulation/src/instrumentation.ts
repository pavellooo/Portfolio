import { ensureKdcEncryptionKeyConfigured } from "@/lib/kdc-encryption-key";

export async function register(): Promise<void> {
  await ensureKdcEncryptionKeyConfigured();
}