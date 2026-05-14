import { createHmac, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { createMocks } from "node-mocks-http";
import authChallengeHandler from "@/pages/api/auth/challenge";
import authPublicKeyHandler from "@/pages/api/auth/public-key";
import authVerifyHandler from "@/pages/api/auth/verify";
import bootstrapVerifyHandler from "@/pages/api/auth/bootstrap-verify";
import { decryptWithAesGcm } from "@/lib/crypto";
import { resetRateLimiterForTests } from "@/lib/rate-limit";
import { resetStorageForTests } from "@/lib/storage";

const AUTH_PROTOCOL_VERSION = "kdc-auth-v2";

function computeVerifierFromKu(ku: Buffer): string {
  return createHmac("sha256", ku).update("kdc-auth-verifier-v2", "utf8").digest("base64");
}

function computeProof(input: { verifierBase64: string; challengeB64: string; ts3: number; n2: string }): string {
  const proofMessage = `${input.challengeB64}.${input.ts3}.${input.n2}`;
  return createHmac("sha256", Buffer.from(input.verifierBase64, "base64")).update(proofMessage, "utf8").digest("base64");
}

function computeBootstrapProof(input: { kcsB64: string; ts5: number; n3: string }): string {
  return createHmac("sha256", Buffer.from(input.kcsB64, "base64")).update(`${input.ts5}.${input.n3}`, "utf8").digest("base64");
}

describe("Auth v2 contracts", () => {
  beforeEach(() => {
    resetStorageForTests();
    resetRateLimiterForTests();

    const signingPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    process.env.KDC_AUTH_PROTOCOL_VERSION = AUTH_PROTOCOL_VERSION;
    process.env.KDC_AUTH_PBKDF2_ITERATIONS = "150000";
    process.env.KDC_AUTH_CHALLENGE_TTL_SECONDS = "300";
    process.env.KDC_AUTH_TIMESTAMP_SKEW_SECONDS = "60";
    process.env.KDC_AUTH_TOKEN_TTL_SECONDS = "300";
    process.env.KDC_AUTH_TOKEN_ISSUER = "kdc";
    process.env.KDC_AUTH_TOKEN_AUDIENCE = "messaging-app-server";
    process.env.KDC_AUTH_SIGNING_PRIVATE_KEY_PEM = signingPair.privateKey;
    process.env.KDC_AUTH_SIGNING_PUBLIC_KEY_PEM = signingPair.publicKey;
    process.env.KDC_AUTH_SIGNING_KID = "kdc-sig-current";
  });

  test("challenge response includes signature and echoes n1", async () => {
    const idc = "opaque-login-id-1";
    const n1 = randomBytes(16).toString("base64");

    const { req, res } = createMocks({
      method: "POST",
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        idc,
        ts1: Date.now(),
        n1
      }
    });

    await authChallengeHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.challengeId).toBeDefined();
    expect(body.n1).toBe(n1);
    expect(body.sig.alg).toBe("RS256");
    expect(body.sig.kid).toBe("kdc-sig-current");
    expect(body.success).toBe(true);
    expect(body.isNewUser).toBe(true);
  });

  test("verify returns token and encClientServerKey", async () => {
    const idc = "opaque-login-id-2";
    const ku = randomBytes(32);
    const verifier = computeVerifierFromKu(ku);

    const challengeReq = createMocks({
      method: "POST",
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        idc,
        ts1: Date.now(),
        n1: randomBytes(16).toString("base64")
      }
    });
    await authChallengeHandler(challengeReq.req, challengeReq.res);
    const challengeBody = JSON.parse(challengeReq.res._getData());

    const n2 = randomBytes(16).toString("base64");
    const ts3 = Date.now();
    const proof = computeProof({
      verifierBase64: verifier,
      challengeB64: challengeBody.challengeB64,
      ts3,
      n2
    });

    const verifyReq = createMocks({
      method: "POST",
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        idc,
        challengeId: challengeBody.challengeId,
        ts3,
        n2,
        ku: ku.toString("base64"),
        verifier,
        proof
      }
    });

    await authVerifyHandler(verifyReq.req, verifyReq.res);

    expect(verifyReq.res._getStatusCode()).toBe(200);
    const body = JSON.parse(verifyReq.res._getData());
    expect(body.success).toBe(true);
    expect(body.token.type).toBe("JWS");
    expect(body.token.alg).toBe("RS256");
    expect(body.token.kid).toBe("kdc-sig-current");
    expect(typeof body.token.value).toBe("string");
    expect(body.encClientServerKey.alg).toBe("AES-256-GCM");

    const kcs = decryptWithAesGcm(body.encClientServerKey, ku);
    expect(kcs).toHaveLength(32);
    expect(typeof body.expiresAt).toBe("string");
  });

  test("bootstrap-verify accepts correct proof and rejects replay", async () => {
    const idc = "opaque-login-id-3";
    const ku = randomBytes(32);
    const verifier = computeVerifierFromKu(ku);

    const challengeReq = createMocks({
      method: "POST",
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        idc,
        ts1: Date.now(),
        n1: randomBytes(16).toString("base64")
      }
    });
    await authChallengeHandler(challengeReq.req, challengeReq.res);
    const challengeBody = JSON.parse(challengeReq.res._getData());

    const n2 = randomBytes(16).toString("base64");
    const ts3 = Date.now();
    const proof = computeProof({ verifierBase64: verifier, challengeB64: challengeBody.challengeB64, ts3, n2 });
    const verifyReq = createMocks({
      method: "POST",
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        idc,
        challengeId: challengeBody.challengeId,
        ts3,
        n2,
        ku: ku.toString("base64"),
        verifier,
        proof
      }
    });
    await authVerifyHandler(verifyReq.req, verifyReq.res);
    const verifyBody = JSON.parse(verifyReq.res._getData());

    const kcs = decryptWithAesGcm(verifyBody.encClientServerKey, ku);
    const token = verifyBody.token.value;

    const ts5 = Date.now();
    const n3 = randomBytes(16).toString("base64");
    const bootstrapProof = computeBootstrapProof({ kcsB64: kcs.toString("base64"), ts5, n3 });

    const bootstrapReq = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        ts5,
        n3,
        proof: bootstrapProof
      }
    });

    await bootstrapVerifyHandler(bootstrapReq.req, bootstrapReq.res);
    expect(bootstrapReq.res._getStatusCode()).toBe(200);

    const replayReq = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        ts5,
        n3,
        proof: bootstrapProof
      }
    });

    await bootstrapVerifyHandler(replayReq.req, replayReq.res);
    expect(replayReq.res._getStatusCode()).toBe(409);
  });

  test("public key endpoint returns the current RS256 key metadata", async () => {
    const { req, res } = createMocks({ method: "GET" });
    await authPublicKeyHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.algorithm).toBe("RS256");
    expect(body.kid).toBe("kdc-sig-current");

    const keyObject = createPublicKey(body.publicKeyPem);
    expect(keyObject.asymmetricKeyType).toBe("rsa");
  });
});