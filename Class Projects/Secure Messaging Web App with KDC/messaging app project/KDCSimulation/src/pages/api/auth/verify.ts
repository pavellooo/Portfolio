import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac } from "node:crypto";
import {
  issueAuthToken,
  assertBase64Key,
  assertConstantTimeBase64Equal,
  assertProofMatchesConstantTime,
  buildAuthVerifyProofInput,
  ensureChallengeNotExpired,
  generateSessionKey,
  assertNonceBase64,
  computeVerifierB64
} from "@/lib/auth";
import { getAuthProtocolVersion, getAuthSigningKid } from "@/lib/config";
import { encryptWithAesGcm } from "@/lib/crypto";
import { sendError, withApiGuards } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { assertBase64, assertNonEmptyString, assertObjectWithExactKeys, assertProtocolVersion, assertUuidV4 } from "@/lib/validation";

type VerifyResponse = {
  success: true;
  userId: string;
  displayAlias: string;
  isNewUser: boolean;
  token: {
    type: "JWS";
    alg: "RS256";
    kid: string;
    value: string;
  };
  encClientServerKey: {
    alg: "AES-256-GCM";
    ivB64: string;
    ciphertextB64: string;
    tagB64: string;
  };
  expiresAt: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse<VerifyResponse>): Promise<void> {
  const decision = checkRateLimit(req, "auth-verify", 30, 60_000);

  if (!decision.allowed) {
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendError(res, 429, "too_many_requests", "Rate limit exceeded");
    return;
  }

  const body = assertObjectWithExactKeys(req.body, ["protocolVersion", "idc", "challengeId", "ts3", "n2", "ku", "verifier", "proof"]);
  assertProtocolVersion(body.protocolVersion, getAuthProtocolVersion());

  const idc = assertNonEmptyString(body.idc, "idc");
  const challengeId = assertUuidV4(body.challengeId, "challengeId");
  const n2 = assertNonceBase64(assertBase64(body.n2, "n2"), "n2");
  const ku = assertBase64Key(assertBase64(body.ku, "ku"), "ku");
  const verifier = assertBase64Key(assertBase64(body.verifier, "verifier"), "verifier");
  const proof = assertBase64(body.proof, "proof");
  const ts3 = Number(body.ts3);

  if (!Number.isInteger(ts3) || ts3 <= 0) {
    sendError(res, 400, "bad_request", "ts3 must be a positive integer");
    return;
  }

  const storage = getStorage();
  const challenge = await storage.getAuthChallengeById(challengeId);
  if (!challenge) {
    sendError(res, 404, "not_found", "Challenge not found");
    return;
  }

  if (challenge.used) {
    sendError(res, 409, "replay", "Challenge already used");
    return;
  }

  if (challenge.idc !== idc) {
    sendError(res, 401, "unauthorized", "Challenge/idc mismatch");
    return;
  }

  ensureChallengeNotExpired(challenge.expiresAt);

  const user = await storage.getUserByIdc(idc);
  if (!user) {
    sendError(res, 404, "not_found", "User not found");
    return;
  }

  const derivedVerifier = computeVerifierB64(Buffer.from(ku, "base64"));
  assertConstantTimeBase64Equal(verifier, derivedVerifier, "verifier");

  if (user.verifierB64) {
    assertConstantTimeBase64Equal(derivedVerifier, user.verifierB64, "verifier");
  }

  const expectedProof = createHmac("sha256", Buffer.from(derivedVerifier, "base64"))
    .update(buildAuthVerifyProofInput({ challengeB64: challenge.challengeB64, ts3, n2 }), "utf8")
    .digest("base64");
  assertProofMatchesConstantTime(proof, expectedProof);

  const verifierRecord = user.verifierB64 ? user : await storage.updateUserVerifierB64(idc, derivedVerifier);
  if (!verifierRecord) {
    sendError(res, 500, "internal", "Internal server error");
    return;
  }

  await storage.markAuthChallengeUsed(challengeId);

  const kcs = generateSessionKey();
  const kcsB64 = kcs.toString("base64");
  const token = issueAuthToken({ userId: verifierRecord.userId, idc, displayAlias: verifierRecord.displayAlias });
  await storage.createSession({
    userId: verifierRecord.userId,
    tokenJti: token.jti,
    kcsB64,
    createdAt: new Date().toISOString(),
    expiresAt: token.expiresAt
  });

  const encClientServerKey = encryptWithAesGcm(kcs, Buffer.from(ku, "base64"));

  res.status(200).json({
    success: true,
    userId: verifierRecord.userId,
    displayAlias: verifierRecord.displayAlias,
    isNewUser: !user.verifierB64,
    token: {
      type: "JWS",
      alg: "RS256",
      kid: getAuthSigningKid(),
      value: token.token
    },
    encClientServerKey,
    expiresAt: token.expiresAt
  });
}

export default withApiGuards<VerifyResponse>(["POST", "OPTIONS"], handler, {
  errorProtocolVersion: getAuthProtocolVersion()
});