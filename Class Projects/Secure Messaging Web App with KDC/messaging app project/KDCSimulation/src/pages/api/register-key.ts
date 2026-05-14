import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, createPrivateKey } from "node:crypto";
import { decodeBase64ExactLength } from "@/lib/encoding";
import { decryptRegisteredUserKey } from "@/lib/crypto";
import { verifyAuthToken } from "@/lib/auth";
import { getKdcPrivateKeyPem, getProtocolVersion } from "@/lib/config";
import { badRequest } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { sendError, withApiGuards } from "@/lib/http";
import { assertBase64, assertNonEmptyString, assertProtocolVersion } from "@/lib/validation";

type RegisterKeyResponse = {
  success: true;
  userId: string;
};

function getBearerToken(req: NextApiRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getExpectedRsaCiphertextBytes(): number {
  const privateKey = createPrivateKey(getKdcPrivateKeyPem());
  const modulusLength = privateKey.asymmetricKeyDetails?.modulusLength;

  if (!Number.isInteger(modulusLength) || typeof modulusLength !== "number" || modulusLength <= 0 || modulusLength % 8 !== 0) {
    throw new Error("KDC private key must be a valid RSA key");
  }

  return modulusLength / 8;
}

function fingerprintKeyBase64(keyBytes: Buffer): string {
  return createHash("sha256").update(keyBytes).digest("base64");
}

function assertRegisterKeyBody(value: unknown): { protocolVersion: unknown; userId?: unknown; encryptedUserKey: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("Request body must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const allowed = ["protocolVersion", "userId", "encryptedUserKey"];
  const actualKeys = Object.keys(record);
  const missing = ["protocolVersion", "encryptedUserKey"].filter((key) => !(key in record));
  if (missing.length > 0) {
    badRequest(`Missing required fields: ${missing.join(", ")}`);
  }

  const extras = actualKeys.filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    badRequest(`Unexpected fields: ${extras.join(", ")}`);
  }

  return {
    protocolVersion: record.protocolVersion,
    userId: record.userId,
    encryptedUserKey: record.encryptedUserKey
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse<RegisterKeyResponse>): Promise<void> {
  const requestId = String(res.getHeader("X-Request-Id") || "unknown-request-id");
  const decision = checkRateLimit(req, "register-key", 30, 60_000);

  if (!decision.allowed) {
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendError(res, 429, "too_many_requests", "Rate limit exceeded");
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    sendError(res, 401, "unauthorized", "Missing bearer token");
    return;
  }

  const body = assertRegisterKeyBody(req.body);
  assertProtocolVersion(body.protocolVersion, getProtocolVersion());
  const encryptedUserKey = assertBase64(body.encryptedUserKey, "encryptedUserKey");
  const claims = verifyAuthToken(token);

  const authenticatedUserId = claims.sub;
  const bodyUserId = body.userId === undefined ? undefined : assertNonEmptyString(body.userId, "userId");

  if (bodyUserId && bodyUserId !== authenticatedUserId) {
    sendError(res, 401, "unauthorized", "Token/user mismatch");
    return;
  }

  const userId = authenticatedUserId;

  let expectedCiphertextBytes: number;
  try {
    expectedCiphertextBytes = getExpectedRsaCiphertextBytes();
  } catch {
    sendError(res, 500, "internal", "KDC RSA key configuration is invalid");
    return;
  }

  try {
    decodeBase64ExactLength(encryptedUserKey, expectedCiphertextBytes, "encryptedUserKey");
  } catch (error) {
    badRequest(error instanceof Error ? error.message : "encryptedUserKey is invalid");
  }

  const decryptedUserKey = decryptRegisteredUserKey(encryptedUserKey);
  if (decryptedUserKey.length !== 32) {
    sendError(res, 400, "bad_request", "Decrypted user key must be exactly 32 bytes");
    return;
  }

  await getStorage().upsertUserKey({
    userId,
    userKeyB64: decryptedUserKey.toString("base64")
  });

  console.info("[register-key] stored canonical user key", {
    requestId,
    authenticatedUserId,
    bodyUserId: bodyUserId ?? null,
    storedKeyFingerprint: fingerprintKeyBase64(decryptedUserKey),
    storedKeyLengthBytes: decryptedUserKey.length
  });

  res.status(200).json({
    success: true,
    userId
  });
}

export default withApiGuards<RegisterKeyResponse>(["POST", "OPTIONS"], handler);