import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "node:crypto";
import { encryptWithAesGcm } from "@/lib/crypto";
import { verifyAuthToken } from "@/lib/auth";
import { sendError, withApiGuards } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { assertBase64, assertNonEmptyString, assertObjectWithExactKeys, assertProtocolVersion } from "@/lib/validation";
import { assertNonceBase64 } from "@/lib/auth";

const SESSION_PROTOCOL_VERSION = "kdc-session-v2";
const CONVERSATION_LIFETIME_SECONDS = 1800;

type CreateSessionResponse = {
  ticketA: {
    alg: "AES-256-GCM";
    ivB64: string;
    ciphertextB64: string;
    tagB64: string;
  };
  ticketB: {
    alg: "AES-256-GCM";
    ivB64: string;
    ciphertextB64: string;
    tagB64: string;
  };
  success: true;
};

function getBearerToken(req: NextApiRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function fingerprintKeyBase64(keyBytes: Buffer): string {
  return createHash("sha256").update(keyBytes).digest("base64");
}

async function handler(req: NextApiRequest, res: NextApiResponse<CreateSessionResponse>): Promise<void> {
  const requestId = String(res.getHeader("X-Request-Id") || "unknown-request-id");
  const decision = checkRateLimit(req, "create-session", 20, 60_000);

  if (!decision.allowed) {
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendError(res, 429, "too_many_requests", "Rate limit exceeded");
    return;
  }

  const tokenA = getBearerToken(req);
  if (!tokenA) {
    sendError(res, 401, "unauthorized", "Missing bearer token");
    return;
  }

  const body = assertObjectWithExactKeys(req.body, [
    "protocolVersion",
    "tokenA",
    "idB",
    "ts1",
    "n1",
    "userIdA",
    "userIdB",
    "requesterUserId",
    "conversationId"
  ]);
  assertProtocolVersion(body.protocolVersion, SESSION_PROTOCOL_VERSION);

  const bodyTokenA = assertNonEmptyString(body.tokenA, "tokenA");
  const canonicalIdB = assertNonEmptyString(body.idB, "idB");
  const userIdA = assertNonEmptyString(body.userIdA, "userIdA");
  const userIdB = assertNonEmptyString(body.userIdB, "userIdB");
  const requesterUserId = assertNonEmptyString(body.requesterUserId, "requesterUserId");
  const conversationId = assertNonEmptyString(body.conversationId, "conversationId");
  const n1 = assertNonceBase64(assertBase64(body.n1, "n1"), "n1");
  const ts1 = Number(body.ts1);
  if (!Number.isInteger(ts1) || ts1 <= 0) {
    sendError(res, 400, "bad_request", "ts1 must be a positive integer");
    return;
  }

  if (bodyTokenA !== tokenA) {
    sendError(res, 401, "unauthorized", "Authorization token mismatch");
    return;
  }

  if (requesterUserId !== userIdA || canonicalIdB !== userIdB) {
    sendError(res, 400, "bad_request", "Identity fields are inconsistent");
    return;
  }

  const claims = verifyAuthToken(tokenA);
  if (claims.sub !== userIdA) {
    sendError(res, 401, "unauthorized", "Token/user mismatch");
    return;
  }

  const storage = getStorage();
  const sessionA = await storage.getSessionByTokenJti(claims.jti);
  if (!sessionA || sessionA.userId !== userIdA) {
    sendError(res, 404, "not_found", "Active session for requester not found");
    return;
  }

  const recipientKeyRecord = await storage.getUserKeyByUserId(canonicalIdB);
  if (!recipientKeyRecord) {
    console.info("[create-session] resolved recipient key for ticketB", {
      requestId,
      requesterUserId: userIdA,
      idB: canonicalIdB,
      lookedUpKeyFingerprint: null,
      lookedUpKeyLengthBytes: null,
      ticketBIssued: false
    });
    sendError(res, 404, "not_found", "Registered user key for peer not found");
    return;
  }

  let recipientKey: Buffer;
  try {
    recipientKey = Buffer.from(assertBase64(recipientKeyRecord.userKeyB64, "userKeyB64"), "base64");
  } catch {
    console.info("[create-session] resolved recipient key for ticketB", {
      requestId,
      requesterUserId: userIdA,
      idB: canonicalIdB,
      lookedUpKeyFingerprint: null,
      lookedUpKeyLengthBytes: null,
      ticketBIssued: false
    });
    sendError(res, 500, "internal", "Registered user key for peer is invalid");
    return;
  }

  if (recipientKey.length !== 32) {
    console.info("[create-session] resolved recipient key for ticketB", {
      requestId,
      requesterUserId: userIdA,
      idB: canonicalIdB,
      lookedUpKeyFingerprint: null,
      lookedUpKeyLengthBytes: recipientKey.length,
      ticketBIssued: false
    });
    sendError(res, 500, "internal", "Registered user key for peer must be exactly 32 bytes");
    return;
  }

  const kConv = randomBytes(32);
  const ts2 = Date.now();
  const ticketAPlain = Buffer.from(
    JSON.stringify({
      kConvB64: kConv.toString("base64"),
      idPeer: canonicalIdB,
      ts2,
      lifetimeSec: CONVERSATION_LIFETIME_SECONDS
    }),
    "utf8"
  );
  const ticketBPlain = Buffer.from(
    JSON.stringify({
      kConvB64: kConv.toString("base64"),
      idPeer: userIdA,
      ts2,
      lifetimeSec: CONVERSATION_LIFETIME_SECONDS
    }),
    "utf8"
  );

  const ticketA = encryptWithAesGcm(ticketAPlain, Buffer.from(sessionA.kcsB64, "base64"));
  const ticketB = encryptWithAesGcm(ticketBPlain, recipientKey);

  console.info("[create-session] resolved recipient key for ticketB", {
    requestId,
    requesterUserId: userIdA,
    idB: canonicalIdB,
    lookedUpKeyFingerprint: fingerprintKeyBase64(recipientKey),
    lookedUpKeyLengthBytes: recipientKey.length,
    ticketBIssued: true
  });

  res.status(200).json({
    ticketA,
    ticketB,
    success: true
  });
}

export default withApiGuards<CreateSessionResponse>(["POST", "OPTIONS"], handler);