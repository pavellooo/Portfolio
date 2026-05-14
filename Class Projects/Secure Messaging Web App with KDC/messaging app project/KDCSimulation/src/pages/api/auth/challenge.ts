import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "node:crypto";
import { createChallengeSignature, generateChallengeB64, generateChallengeId, generateDisplayAlias, generateSaltBase64, generateUserId } from "@/lib/auth";
import { getAuthIterationsDefault, getAuthProtocolVersion, getAuthSigningKid } from "@/lib/config";
import { sendError, withApiGuards } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { assertBase64, assertNonEmptyString, assertObjectWithExactKeys, assertProtocolVersion } from "@/lib/validation";
import { assertNonceBase64 } from "@/lib/auth";

type AuthChallengeResponse = {
  challengeId: string;
  saltB64: string;
  iterations: number;
  challengeB64: string;
  ts2: number;
  n1: string;
  sig: {
    alg: "RS256";
    kid: string;
    valueB64: string;
  };
  success: true;
  isNewUser: boolean;
};

async function handler(req: NextApiRequest, res: NextApiResponse<AuthChallengeResponse>): Promise<void> {
  const requestId = String(res.getHeader("X-Request-Id") || "unknown-request-id");
  const decision = checkRateLimit(req, "auth-challenge", 30, 60_000);

  if (!decision.allowed) {
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendError(res, 429, "too_many_requests", "Rate limit exceeded");
    return;
  }

  const body = assertObjectWithExactKeys(req.body, ["protocolVersion", "idc", "ts1", "n1"]);
  assertProtocolVersion(body.protocolVersion, getAuthProtocolVersion());

  const idc = assertNonEmptyString(body.idc, "idc");
  const n1 = assertNonceBase64(assertBase64(body.n1, "n1"), "n1");
  const ts1 = Number(body.ts1);
  if (!Number.isInteger(ts1) || ts1 <= 0) {
    sendError(res, 400, "bad_request", "ts1 must be a positive integer");
    return;
  }

  const storage = getStorage();
  const existingUser = await storage.getUserByIdc(idc);
  const isNewUser = !existingUser;
  const challengeId = generateChallengeId();
  const challengeB64 = generateChallengeB64();
  const ts2 = Date.now();
  const expiresAt = new Date(ts2 + 300_000).toISOString();

  let user = existingUser;
  if (!user) {
    user = await storage.upsertUserByIdc({
      idc,
      userId: generateUserId(),
      displayAlias: generateDisplayAlias(),
      saltB64: generateSaltBase64(),
      iterations: getAuthIterationsDefault(),
      verifierB64: ""
    });
  }

  await storage.createAuthChallenge({
    challengeId,
    idc,
    challengeB64,
    n1,
    ts2,
    expiresAt
  });

  const sigValueB64 = createChallengeSignature({ challengeB64, ts2, n1 });

  res.status(200).json({
    challengeId,
    saltB64: user.saltB64,
    iterations: user.iterations,
    challengeB64,
    ts2,
    n1,
    sig: {
      alg: "RS256",
      kid: getAuthSigningKid(),
      valueB64: sigValueB64
    },
    success: true,
    isNewUser
  });
}

export default withApiGuards<AuthChallengeResponse>(["POST", "OPTIONS"], handler, {
  errorProtocolVersion: getAuthProtocolVersion()
});