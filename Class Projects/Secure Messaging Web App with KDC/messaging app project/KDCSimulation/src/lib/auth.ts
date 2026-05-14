import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  getAuthChallengeTtlSeconds,
  getAuthSigningKid,
  getAuthSigningPrivateKeyPem,
  getAuthSigningPublicKeyPem,
  getAuthTokenAudience,
  getAuthTokenIssuer,
  getAuthTokenTtlSeconds,
  getAuthTimestampSkewSeconds
} from "@/lib/config";
import { decodeBase64ExactLength, decodeBase64Strict, toBase64 } from "@/lib/encoding";
import { badRequest, unauthorized } from "@/lib/errors";

const BASE64_KEY_BYTES = 32;
const NONCE_BYTES = 16;
const CHALLENGE_BYTES = 32;
const SALT_BYTES = 16;
const SESSION_KEY_BYTES = 32;
const JWT_SIGNATURE_BYTES_MIN = 64;

const ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "daring",
  "eager",
  "fuzzy",
  "glossy",
  "happy",
  "ivory",
  "jolly",
  "kind",
  "lively",
  "mellow",
  "nimble",
  "opal",
  "plucky",
  "quick",
  "royal",
  "sunny",
  "tidy"
];

const NOUNS = [
  "falcon",
  "harbor",
  "island",
  "jungle",
  "kitten",
  "lantern",
  "meadow",
  "nebula",
  "oasis",
  "pioneer",
  "quartz",
  "raven",
  "summit",
  "thunder",
  "uplink",
  "voyager",
  "whisper",
  "xenon",
  "yonder",
  "zephyr"
];

function toBase64Url(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input, "utf8").toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function parseJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    unauthorized("Invalid token format");
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;

  try {
    header = JSON.parse(fromBase64Url(headerPart).toString("utf8")) as Record<string, unknown>;
    payload = JSON.parse(fromBase64Url(payloadPart).toString("utf8")) as Record<string, unknown>;
  } catch {
    unauthorized("Invalid token payload");
  }

  const signature = fromBase64Url(signaturePart);
  if (signature.length < JWT_SIGNATURE_BYTES_MIN) {
    unauthorized("Invalid token signature");
  }

  return {
    header,
    payload,
    signingInput: `${headerPart}.${payloadPart}`,
    signature
  };
}

function signRs256(signingInput: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return toBase64Url(signer.sign(getAuthSigningPrivateKeyPem()));
}

function verifyRs256(signingInput: string, signature: Buffer): void {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();

  const ok = verifier.verify(getAuthSigningPublicKeyPem(), signature);
  if (!ok) {
    unauthorized("Invalid JWT signature");
  }
}

function ensureStringClaim(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    unauthorized(`Missing or invalid ${fieldName}`);
  }

  return value;
}

function ensureNumberClaim(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    unauthorized(`Missing or invalid ${fieldName}`);
  }

  return value;
}

export function generateSaltBase64(): string {
  return toBase64(randomBytes(SALT_BYTES));
}

export function generateNonceBase64(): string {
  return toBase64(randomBytes(NONCE_BYTES));
}

export function generateChallengeB64(): string {
  return toBase64(randomBytes(CHALLENGE_BYTES));
}

export function generateChallengeId(): string {
  return randomUUID();
}

export function generateUserId(): string {
  return `u_${randomBytes(8).toString("hex")}`;
}

export function generateTokenJti(): string {
  return randomUUID();
}

export function generateDisplayAlias(): string {
  const adjective = ADJECTIVES[randomBytes(1)[0] % ADJECTIVES.length];
  const noun = NOUNS[randomBytes(1)[0] % NOUNS.length];
  const digits = String(randomBytes(2).readUInt16BE(0) % 10000).padStart(4, "0");
  return `${adjective}-${noun}-${digits}`;
}

export function deriveKuFromPassword(password: string, saltB64: string, iterations: number): Buffer {
  const salt = decodeBase64Strict(saltB64, "saltB64");
  return pbkdf2Sync(password, salt, iterations, BASE64_KEY_BYTES, "sha256");
}

export function computeVerifierB64(ku: Buffer): string {
  if (ku.length !== BASE64_KEY_BYTES) {
    badRequest("Ku must be 32 bytes");
  }

  return toBase64(createHmac("sha256", ku).update("kdc-auth-verifier-v2", "utf8").digest());
}

export function buildChallengeSignatureInput(input: { challengeB64: string; ts2: number; n1: string }): string {
  return `${input.challengeB64}.${input.ts2}.${input.n1}`;
}

export function buildAuthVerifyProofInput(input: { challengeB64: string; ts3: number; n2: string }): string {
  return `${input.challengeB64}.${input.ts3}.${input.n2}`;
}

export function buildBootstrapProofInput(input: { ts5: number; n3: string }): string {
  return `${input.ts5}.${input.n3}`;
}

export function computeHmacSha256Base64(keyBase64: string, message: string): string {
  const key = decodeBase64ExactLength(keyBase64, BASE64_KEY_BYTES, "key");
  return toBase64(createHmac("sha256", key).update(message, "utf8").digest());
}

export function assertConstantTimeBase64Equal(providedBase64: string, expectedBase64: string, fieldName: string): void {
  const provided = decodeBase64ExactLength(providedBase64, BASE64_KEY_BYTES, fieldName);
  const expected = decodeBase64ExactLength(expectedBase64, BASE64_KEY_BYTES, `${fieldName}Expected`);

  if (!timingSafeEqual(provided, expected)) {
    unauthorized("Invalid proof");
  }
}

export function ensureTimestampWithinSkew(timestampMs: number, nowMs?: number): void {
  const now = nowMs ?? Date.now();
  const skewMs = getAuthTimestampSkewSeconds() * 1000;
  if (Math.abs(now - timestampMs) > skewMs) {
    unauthorized("Timestamp is outside the allowed skew window");
  }
}

export function ensureChallengeNotExpired(expiresAtIso: string, nowMs?: number): void {
  const now = nowMs ?? Date.now();
  if (Date.parse(expiresAtIso) <= now) {
    unauthorized("Challenge expired");
  }
}

export function computeChallengeExpiry(issuedAtIso: string): string {
  const issuedMs = Date.parse(issuedAtIso);
  return new Date(issuedMs + getAuthChallengeTtlSeconds() * 1000).toISOString();
}

export function issueAuthToken(input: { userId: string; idc: string; displayAlias: string; nowMs?: number }): { token: string; jti: string; exp: number; expiresAt: string } {
  const nowMs = input.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + getAuthTokenTtlSeconds();
  const jti = generateTokenJti();

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: getAuthSigningKid()
  };

  const payload = {
    sub: input.userId,
    jti,
    idc: input.idc,
    displayAlias: input.displayAlias,
    iat,
    exp,
    iss: getAuthTokenIssuer(),
    aud: getAuthTokenAudience()
  };

  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const signature = signRs256(signingInput);

  return {
    token: `${signingInput}.${signature}`,
    jti,
    exp,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

export function verifyAuthToken(token: string): { sub: string; jti: string; idc: string; displayAlias: string; exp: number } {
  const parsed = parseJwt(token);
  const { header, payload, signingInput, signature } = parsed;

  if (header.alg !== "RS256") {
    unauthorized("Unsupported token algorithm");
  }

  verifyRs256(signingInput, signature);

  const sub = ensureStringClaim(payload.sub, "sub");
  const jti = ensureStringClaim(payload.jti, "jti");
  const idc = ensureStringClaim(payload.idc, "idc");
  const displayAlias = ensureStringClaim(payload.displayAlias, "displayAlias");
  const exp = ensureNumberClaim(payload.exp, "exp");
  const iss = ensureStringClaim(payload.iss, "iss");
  const aud = ensureStringClaim(payload.aud, "aud");

  if (iss !== getAuthTokenIssuer()) {
    unauthorized("Invalid token issuer");
  }

  if (aud !== getAuthTokenAudience()) {
    unauthorized("Invalid token audience");
  }

  if (Math.floor(Date.now() / 1000) >= exp) {
    unauthorized("Token expired");
  }

  return { sub, jti, idc, displayAlias, exp };
}

export function assertProofMatchesConstantTime(providedProofBase64: string, expectedProofBase64: string): void {
  const provided = decodeBase64ExactLength(providedProofBase64, BASE64_KEY_BYTES, "proof");
  const expected = decodeBase64ExactLength(expectedProofBase64, BASE64_KEY_BYTES, "expectedProof");

  if (!timingSafeEqual(provided, expected)) {
    unauthorized("Invalid proof");
  }
}

export function createChallengeSignature(input: { challengeB64: string; ts2: number; n1: string }): string {
  const signingInput = buildChallengeSignatureInput(input);
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput, "utf8");
  signer.end();
  return toBase64(signer.sign(getAuthSigningPrivateKeyPem()));
}

export function getAuthSigningPublicKeyPemSafe(): string {
  return getAuthSigningPublicKeyPem();
}

export function getAuthSigningJwk(): Record<string, string> {
  const key = createPublicKey(getAuthSigningPublicKeyPem());
  const exported = key.export({ format: "jwk" });

  if (!exported || typeof exported !== "object") {
    throw new Error("Unable to export auth signing key as JWK");
  }

  const jwk = exported as Record<string, string>;
  return {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    alg: "RS256",
    use: "sig",
    kid: getAuthSigningKid()
  };
}

export function generateSessionKey(): Buffer {
  return randomBytes(SESSION_KEY_BYTES);
}

export function assertNonceBase64(value: string, fieldName: string): string {
  decodeBase64ExactLength(value, NONCE_BYTES, fieldName);
  return value;
}

export function assertBase64Key(value: string, fieldName: string): string {
  decodeBase64ExactLength(value, BASE64_KEY_BYTES, fieldName);
  return value;
}
