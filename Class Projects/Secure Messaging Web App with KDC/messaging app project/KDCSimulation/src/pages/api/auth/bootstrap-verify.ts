import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac } from "node:crypto";
import { buildBootstrapProofInput, assertBase64Key, assertNonceBase64, assertProofMatchesConstantTime, verifyAuthToken } from "@/lib/auth";
import { getAuthProtocolVersion } from "@/lib/config";
import { sendError, withApiGuards } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { assertBase64, assertObjectWithExactKeys, assertProtocolVersion } from "@/lib/validation";

type BootstrapVerifyResponse = {
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

async function handler(req: NextApiRequest, res: NextApiResponse<BootstrapVerifyResponse>): Promise<void> {
  const decision = checkRateLimit(req, "auth-bootstrap-verify", 30, 60_000);

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

  const body = assertObjectWithExactKeys(req.body, ["protocolVersion", "ts5", "n3", "proof"]);
  assertProtocolVersion(body.protocolVersion, getAuthProtocolVersion());

  const n3 = assertNonceBase64(assertBase64(body.n3, "n3"), "n3");
  const ts5 = Number(body.ts5);
  if (!Number.isInteger(ts5) || ts5 <= 0) {
    sendError(res, 400, "bad_request", "ts5 must be a positive integer");
    return;
  }
  const proof = assertBase64Key(assertBase64(body.proof, "proof"), "proof");

  const claims = verifyAuthToken(token);
  const storage = getStorage();
  const session = await storage.getSessionByTokenJti(claims.jti);

  if (!session || session.userId !== claims.sub) {
    sendError(res, 404, "not_found", "Active session not found");
    return;
  }

  const accepted = await storage.markBootstrapNonceUsed({
    userId: claims.sub,
    tokenJti: claims.jti,
    n3,
    expiresAt: session.expiresAt
  });

  if (!accepted) {
    sendError(res, 409, "replay", "Replay detected");
    return;
  }

  const expectedProof = createHmac("sha256", Buffer.from(session.kcsB64, "base64"))
    .update(buildBootstrapProofInput({ ts5, n3 }), "utf8")
    .digest("base64");
  assertProofMatchesConstantTime(proof, expectedProof);

  res.status(200).json({
    success: true,
    userId: claims.sub
  });
}

export default withApiGuards<BootstrapVerifyResponse>(["POST", "OPTIONS"], handler, {
  errorProtocolVersion: getAuthProtocolVersion()
});