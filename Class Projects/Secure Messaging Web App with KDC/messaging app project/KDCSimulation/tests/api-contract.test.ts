import { constants, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, publicEncrypt, randomBytes } from "node:crypto";
import { createMocks } from "node-mocks-http";
import authChallengeHandler from "@/pages/api/auth/challenge";
import authVerifyHandler from "@/pages/api/auth/verify";
import authPublicKeyHandler from "@/pages/api/auth/public-key";
import bootstrapVerifyHandler from "@/pages/api/auth/bootstrap-verify";
import createSessionHandler from "../src/pages/api/create-session";
import registerKeyHandler from "../src/pages/api/register-key";
import kdcPublicKeyHandler from "@/pages/api/keys/public-key";
import { decryptWithAesGcm } from "@/lib/crypto";
import { resetRateLimiterForTests } from "@/lib/rate-limit";
import { resetStorageForTests } from "@/lib/storage";

const PROTOCOL_VERSION = "kdc-proto-v1";
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

describe("KDC v2 endpoint contracts", () => {
  beforeEach(() => {
    resetStorageForTests();
    resetRateLimiterForTests();

    const encryptionPair = generateKeyPairSync("rsa", {
      modulusLength: 3072,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    const signingPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    process.env.KDC_PRIVATE_KEY_PEM = encryptionPair.privateKey;
    process.env.KDC_PUBLIC_KEY_PEM = encryptionPair.publicKey;
    process.env.KDC_PROTOCOL_VERSION = PROTOCOL_VERSION;
    process.env.KDC_DEFAULT_TTL_SECONDS = "86400";
    process.env.KDC_ALLOWED_ORIGINS = "http://localhost:5001";
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
    process.env.KDC_ENCRYPTION_KEY_KID = "test-register-key-kid";
  });

  function encryptForKdcPublicKey(plaintext: Buffer): string {
    return publicEncrypt(
      {
        key: process.env.KDC_PUBLIC_KEY_PEM as string,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
      },
      plaintext
    ).toString("base64");
  }

  async function authenticateUser(idc: string, verifierSecret: Buffer) {
    const ku = verifierSecret;
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
    return { ku, verifier, verifyBody };
  }

  test("auth public-key endpoint returns RS256 PEM metadata", async () => {
    const { req, res } = createMocks({ method: "GET" });
    await authPublicKeyHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.algorithm).toBe("RS256");
    expect(body.kid).toBe("kdc-sig-current");
    const keyObject = createPublicKey(body.publicKeyPem);
    expect(keyObject.asymmetricKeyType).toBe("rsa");
  });

  test("register-key rejects ciphertext sizes that do not match configured RSA modulus bytes", async () => {
    const { verifyBody } = await authenticateUser("alice-idc", randomBytes(32));
    const expectedBytes = (createPrivateKey(process.env.KDC_PRIVATE_KEY_PEM as string).asymmetricKeyDetails?.modulusLength ?? 0) / 8;

    const { req, res } = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${verifyBody.token.value}` },
      body: {
        protocolVersion: PROTOCOL_VERSION,
        userId: verifyBody.userId,
        encryptedUserKey: "QUJD"
      }
    });

    await registerKeyHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
    const body = JSON.parse(res._getData());
    expect(body.error).toContain(`${expectedBytes} bytes`);
  });

  test("register-key accepts 384-byte ciphertext and binds to the bearer subject", async () => {
    const { verifyBody } = await authenticateUser("bob-idc", randomBytes(32));
    const ciphertext = encryptForKdcPublicKey(randomBytes(32));

    const { req, res } = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${verifyBody.token.value}` },
      body: {
        protocolVersion: PROTOCOL_VERSION,
        userId: verifyBody.userId,
        encryptedUserKey: ciphertext
      }
    });

    await registerKeyHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  test("create-session returns ticketA and ticketB AES-GCM envelopes", async () => {
    const aliceAuth = await authenticateUser("alice-session-idc", randomBytes(32));
    const bobAuth = await authenticateUser("bob-session-idc", randomBytes(32));
    const bobUserConversationKey = randomBytes(32);

    const registerBobKeyReq = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${bobAuth.verifyBody.token.value}` },
      body: {
        protocolVersion: PROTOCOL_VERSION,
        userId: bobAuth.verifyBody.userId,
        encryptedUserKey: encryptForKdcPublicKey(bobUserConversationKey)
      }
    });

    await registerKeyHandler(registerBobKeyReq.req, registerBobKeyReq.res);
    expect(registerBobKeyReq.res._getStatusCode()).toBe(200);

    const { req, res } = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${aliceAuth.verifyBody.token.value}` },
      body: {
        protocolVersion: "kdc-session-v2",
        tokenA: aliceAuth.verifyBody.token.value,
        idB: bobAuth.verifyBody.userId,
        ts1: Date.now(),
        n1: randomBytes(16).toString("base64"),
        userIdA: aliceAuth.verifyBody.userId,
        userIdB: bobAuth.verifyBody.userId,
        requesterUserId: aliceAuth.verifyBody.userId,
        conversationId: "conv-123"
      }
    });

    await createSessionHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.ticketA.alg).toBe("AES-256-GCM");
    expect(body.ticketB.alg).toBe("AES-256-GCM");

    const aliceKcs = decryptWithAesGcm(aliceAuth.verifyBody.encClientServerKey, aliceAuth.ku);

    const ticketAPlain = JSON.parse(decryptWithAesGcm(body.ticketA, aliceKcs).toString("utf8"));
    const ticketBPlain = JSON.parse(decryptWithAesGcm(body.ticketB, bobUserConversationKey).toString("utf8"));
    expect(ticketAPlain.idPeer).toBe(bobAuth.verifyBody.userId);
    expect(ticketBPlain.idPeer).toBe(aliceAuth.verifyBody.userId);
    expect(ticketAPlain.kConvB64).toBe(ticketBPlain.kConvB64);
  });

  test("bootstrap replay reuses same n3 and is rejected", async () => {
    const auth = await authenticateUser("bootstrap-idc", randomBytes(32));
    const kcs = decryptWithAesGcm(auth.verifyBody.encClientServerKey, auth.ku);

    const ts5 = Date.now();
    const n3 = randomBytes(16).toString("base64");
    const proof = computeBootstrapProof({ kcsB64: kcs.toString("base64"), ts5, n3 });

    const firstReq = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${auth.verifyBody.token.value}` },
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        ts5,
        n3,
        proof
      }
    });

    await bootstrapVerifyHandler(firstReq.req, firstReq.res);
    expect(firstReq.res._getStatusCode()).toBe(200);

    const replayReq = createMocks({
      method: "POST",
      headers: { authorization: `Bearer ${auth.verifyBody.token.value}` },
      body: {
        protocolVersion: AUTH_PROTOCOL_VERSION,
        ts5,
        n3,
        proof
      }
    });

    await bootstrapVerifyHandler(replayReq.req, replayReq.res);
    expect(replayReq.res._getStatusCode()).toBe(409);
  });
});
