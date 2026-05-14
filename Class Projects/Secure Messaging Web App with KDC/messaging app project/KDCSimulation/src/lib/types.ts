export const KDC_KEY_ALG = "rsa-oaep-sha256" as const;
export const KDC_ENCRYPTION_KEY_ALGORITHM = "RSA-OAEP-256" as const;
export const KDC_ENCRYPTION_KEY_USE = "enc" as const;

export const AES_ENVELOPE_ALGORITHM = "AES-256-GCM" as const;
export const AUTH_JWT_ALGORITHM = "RS256" as const;
export const AUTH_CHALLENGE_SIGNATURE_ALGORITHM = "RS256" as const;
export const AUTH_BOOTSTRAP_PROOF_ALGORITHM = "HMAC-SHA-256" as const;

export type AesGcmEnvelope = {
  alg: typeof AES_ENVELOPE_ALGORITHM;
  ivB64: string;
  ciphertextB64: string;
  tagB64: string;
};

export type UserKeyRecord = {
  userId: string;
  userKeyB64: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRecord = {
  userId: string;
  tokenJti: string;
  kcsB64: string;
  createdAt: string;
  expiresAt: string;
};

export type UserAuthRecord = {
  idc: string;
  userId: string;
  displayAlias: string;
  saltB64: string;
  iterations: number;
  verifierB64: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthChallengeRecord = {
  challengeId: string;
  idc: string;
  challengeB64: string;
  n1: string;
  ts2: number;
  used: boolean;
  expiresAt: string;
};

export type ApiErrorCode = "bad_request" | "not_found" | "conflict" | "unauthorized" | "too_many_requests" | "internal" | "replay";

export type ApiErrorBody = {
  error: string;
  code?: ApiErrorCode;
};
