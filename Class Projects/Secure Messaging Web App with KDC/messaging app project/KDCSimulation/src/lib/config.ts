const DEFAULT_PROTOCOL_VERSION = "kdc-proto-v1";
const DEFAULT_AUTH_PROTOCOL_VERSION = "kdc-auth-v2";
const DEFAULT_TTL_SECONDS = 86400;
const DEFAULT_AUTH_ITERATIONS = 150000;
const DEFAULT_AUTH_CHALLENGE_TTL_SECONDS = 300;
const DEFAULT_AUTH_TIMESTAMP_SKEW_SECONDS = 60;
const DEFAULT_AUTH_TOKEN_TTL_SECONDS = 300;
const DEFAULT_AUTH_TOKEN_ISSUER = "kdc";
const DEFAULT_AUTH_TOKEN_AUDIENCE = "messaging-app-server";
const DEFAULT_KDC_ENCRYPTION_KEY_KID = "kdc-register-key-rsa3072-v1";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getPositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function getProtocolVersion(): string {
  return process.env.KDC_PROTOCOL_VERSION?.trim() || DEFAULT_PROTOCOL_VERSION;
}

export function getAuthProtocolVersion(): string {
  return process.env.KDC_AUTH_PROTOCOL_VERSION?.trim() || DEFAULT_AUTH_PROTOCOL_VERSION;
}

export function getDefaultTtlSeconds(): number {
  return getPositiveIntegerEnv("KDC_DEFAULT_TTL_SECONDS", DEFAULT_TTL_SECONDS);
}

export function getAllowedOrigins(): string[] {
  const raw = process.env.KDC_ALLOWED_ORIGINS;
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getKdcPrivateKeyPem(): string {
  return getRequiredEnv("KDC_PRIVATE_KEY_PEM");
}

export function getKdcPublicKeyPem(): string {
  return getRequiredEnv("KDC_PUBLIC_KEY_PEM");
}

export function getKdcEncryptionKeyKid(): string {
  return process.env.KDC_ENCRYPTION_KEY_KID?.trim() || DEFAULT_KDC_ENCRYPTION_KEY_KID;
}

export function getAuthIterationsDefault(): number {
  return getPositiveIntegerEnv("KDC_AUTH_PBKDF2_ITERATIONS", DEFAULT_AUTH_ITERATIONS);
}

export function getAuthChallengeTtlSeconds(): number {
  return getPositiveIntegerEnv("KDC_AUTH_CHALLENGE_TTL_SECONDS", DEFAULT_AUTH_CHALLENGE_TTL_SECONDS);
}

export function getAuthTimestampSkewSeconds(): number {
  return getPositiveIntegerEnv("KDC_AUTH_TIMESTAMP_SKEW_SECONDS", DEFAULT_AUTH_TIMESTAMP_SKEW_SECONDS);
}

export function getAuthTokenTtlSeconds(): number {
  return getPositiveIntegerEnv("KDC_AUTH_TOKEN_TTL_SECONDS", DEFAULT_AUTH_TOKEN_TTL_SECONDS);
}

export function getAuthTokenIssuer(): string {
  return process.env.KDC_AUTH_TOKEN_ISSUER?.trim() || DEFAULT_AUTH_TOKEN_ISSUER;
}

export function getAuthTokenAudience(): string {
  return process.env.KDC_AUTH_TOKEN_AUDIENCE?.trim() || DEFAULT_AUTH_TOKEN_AUDIENCE;
}

export function getAuthSigningPrivateKeyPem(): string {
  return getRequiredEnv("KDC_AUTH_SIGNING_PRIVATE_KEY_PEM");
}

export function getAuthSigningPublicKeyPem(): string {
  return getRequiredEnv("KDC_AUTH_SIGNING_PUBLIC_KEY_PEM");
}

export function getAuthSigningKid(): string {
  return process.env.KDC_AUTH_SIGNING_KID?.trim() || "kdc-sig-current";
}
