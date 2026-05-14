// API service for making requests to the backend
const API_URL = '/api';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_DEV = !IS_PRODUCTION;

function trimTrailingSlash(value) {
  return (value || '').replace(/\/+$/, '');
}

function resolveKdcUrl() {
  const prodUrl = process.env.REACT_APP_KDC_URL_PROD || process.env.REACT_APP_KDC_URL || '';
  const devUrl = process.env.REACT_APP_KDC_URL_DEV || process.env.REACT_APP_KDC_URL || 'http://localhost:4000';
  return trimTrailingSlash(IS_PRODUCTION ? prodUrl : devUrl);
}

function resolveKdcPublicKeyPem() {
  const prodKey = process.env.REACT_APP_KDC_PUBLIC_KEY_PEM_PROD || process.env.REACT_APP_KDC_PUBLIC_KEY_PEM || '';
  const devKey = process.env.REACT_APP_KDC_PUBLIC_KEY_PEM_DEV || process.env.REACT_APP_KDC_PUBLIC_KEY_PEM || '';
  return (IS_PRODUCTION ? prodKey : devKey).replace(/\\n/g, '\n');
}

const KDC_URL = resolveKdcUrl();
const KDC_PUBLIC_KEY_PEM = resolveKdcPublicKeyPem();
const KDC_AUTH_ENABLED = String(process.env.REACT_APP_KDC_AUTH_ENABLED || '').toLowerCase() === 'true';
const KDC_API_PREFIX = String(process.env.REACT_APP_KDC_API_PREFIX || '/api').trim();
const KDC_USE_BACKEND_PROXY = !IS_PRODUCTION && String(process.env.REACT_APP_KDC_USE_PROXY || 'true').toLowerCase() === 'true';
const KDC_AUTH_PROTOCOL_VERSION_V2 = 'kdc-auth-v2';
const KDC_KEY_PROTOCOL_VERSION = 'kdc-proto-v1';
const KDC_AUTH_TOKEN_STORAGE_KEY = 'kdc_auth_token_v1';
const KDC_CLIENT_SERVER_KEY_STORAGE_KEY = 'kdc_client_server_key_v1';
const USER_KEY_STORAGE_PREFIX = 'kdc_user_key_wrap_v1:';
const ACTIVE_USER_KEY_PREFIX = 'kdc_active_user_key_v1:';
const ACTIVE_SESSION_KEY_PREFIX = 'kdc_session_key_v2:';
const KDC_PENDING_TICKET_B_PREFIX = 'kdc_ticket_b_v1:';
const AES_GCM_ALGORITHM = 'AES-GCM';
const AES_KEY_LENGTH_BYTES = 32;
let hasLoggedRegisterKeyFailure = false;
let hasLoggedCreateSessionFailure = false;
let kdcRegisterKeyUnavailable = false;
let kdcCreateSessionUnavailable = false;
let registerKeyMaterialCache = null;

function clearAllKdcSessionState() {
  const removablePrefixes = [
    KDC_AUTH_TOKEN_STORAGE_KEY,
    KDC_CLIENT_SERVER_KEY_STORAGE_KEY,
    ACTIVE_USER_KEY_PREFIX,
    ACTIVE_SESSION_KEY_PREFIX,
    KDC_PENDING_TICKET_B_PREFIX
  ];

  const keys = Object.keys(sessionStorage);
  keys.forEach((key) => {
    const shouldRemove = removablePrefixes.some((prefix) => key === prefix || key.startsWith(prefix));
    if (shouldRemove) {
      sessionStorage.removeItem(key);
    }
  });
}

function normalizeLoginInput(value) {
  return String(value || '').trim().toLowerCase();
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Bytes(inputBytes) {
  const digest = await window.crypto.subtle.digest('SHA-256', inputBytes);
  return new Uint8Array(digest);
}

async function deriveAuthKeyBytes(password, saltBase64, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const saltBytes = base64ToBytes(saltBase64);
  const derivedBits = await window.crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: saltBytes,
    iterations: Number(iterations) || 150000,
    hash: 'SHA-256'
  }, keyMaterial, 256);

  return new Uint8Array(derivedBits);
}

async function hmacSha256Base64(keyBytes, message) {
  const encoder = new TextEncoder();
  const key = await window.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await window.crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToBase64(new Uint8Array(signature));
}

async function computeOpaqueLoginId(loginInput) {
  const encoder = new TextEncoder();
  const digest = await sha256Bytes(encoder.encode(`login-id:v1:${normalizeLoginInput(loginInput)}`));
  return bytesToBase64Url(digest);
}

async function performKdcAuthLogin(loginInput, password) {
  if (!KDC_USE_BACKEND_PROXY && !KDC_URL) {
    throw new Error('KDC URL is not configured for KDC auth login');
  }

  const loginId = await computeOpaqueLoginId(loginInput);

  const challengeNonce = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
  const challengeRequestTs = Date.now();
  const challenge = await postKdc('auth/challenge', {
    protocolVersion: KDC_AUTH_PROTOCOL_VERSION_V2,
    idc: loginId,
    ts1: challengeRequestTs,
    n1: challengeNonce
  });

  const salt = challenge.saltB64;
  const iterations = challenge.iterations || 150000;
  const challengeId = challenge.challengeId;
  const challengeValue = challenge.challengeB64;
  const challengeTs = challenge.ts2;
  const echoedNonce = challenge.n1 || '';
  const challengeSignature = challenge.sig;

  if (!salt || !challengeId || !challengeValue) {
    throw new Error('KDC challenge response missing required fields');
  }

  if (echoedNonce !== challengeNonce) {
    throw new Error('KDC challenge nonce mismatch');
  }

  if (!challengeSignature) {
    throw new Error('KDC challenge signature is required');
  }

  const signatureOk = await verifyKdcChallengeSignature({
    challengeValue,
    ts2: challengeTs,
    n1: challengeNonce,
    signature: challengeSignature
  });

  if (!signatureOk) {
    throw new Error('KDC challenge signature verification failed');
  }

  const authKeyBytes = await deriveAuthKeyBytes(password, salt, iterations);
  const verifier = await hmacSha256Base64(authKeyBytes, 'kdc-auth-verifier-v2');
  const n2 = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
  const ts3 = Date.now();
  const proofMessage = `${challengeValue}.${ts3}.${n2}`;
  const verifierBytes = base64ToBytes(verifier);
  const proof = await hmacSha256Base64(verifierBytes, proofMessage);

  const verify = await postKdc('auth/verify', {
    protocolVersion: KDC_AUTH_PROTOCOL_VERSION_V2,
    idc: loginId,
    challengeId,
    ts3,
    n2,
    ku: bytesToBase64(authKeyBytes),
    verifier,
    proof
  });

  const resolvedVerifyUserId = verify && (verify.userId || '');
  if (!verify || !verify.success || !resolvedVerifyUserId) {
    throw new Error('KDC auth verification failed');
  }

  const resolvedToken =
    (typeof verify.token === 'string' && verify.token)
    || (verify.token && typeof verify.token.value === 'string' && verify.token.value)
    || '';

  if (!resolvedToken) {
    throw new Error('KDC verify response missing token');
  }

  // Backend bootstrap requires an RS256 JWT, not an opaque token.
  if (resolvedToken.split('.').length !== 3) {
    throw new Error('KDC verify token is not a JWT (expected header.payload.signature)');
  }

  if (resolvedToken) {
    clearAllKdcSessionState();
    sessionStorage.setItem(KDC_AUTH_TOKEN_STORAGE_KEY, resolvedToken);
  } else {
    sessionStorage.removeItem(KDC_AUTH_TOKEN_STORAGE_KEY);
  }

  const encryptedClientServerKey = verify.encClientServerKey || null;
  let clientServerKeyBase64 = '';
  if (encryptedClientServerKey) {
    try {
      const clientServerKeyBytes = await decryptKdcAesEnvelope(encryptedClientServerKey, authKeyBytes);
      clientServerKeyBase64 = bytesToBase64(clientServerKeyBytes);
      sessionStorage.setItem(KDC_CLIENT_SERVER_KEY_STORAGE_KEY, clientServerKeyBase64);
    } catch (error) {
      throw new Error(`KDC client-server key decrypt failed: ${error.message || String(error)}`);
    }
  } else {
    sessionStorage.removeItem(KDC_CLIENT_SERVER_KEY_STORAGE_KEY);
  }

  if (!clientServerKeyBase64) {
    throw new Error('KDC verify response missing encClientServerKey');
  }

  const ts5 = Date.now();
  const n3 = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
  let bootstrapProof = '';
  if (clientServerKeyBase64) {
    bootstrapProof = await hmacSha256Base64(
      base64ToBytes(clientServerKeyBase64),
      `${ts5}.${n3}`
    );
  }

  if (!bootstrapProof) {
    throw new Error('Unable to create KDC bootstrap proof');
  }

  const response = await fetch(`${API_URL}/login/kdc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      protocolVersion: KDC_AUTH_PROTOCOL_VERSION_V2,
      token: resolvedToken,
      ts5,
      n3,
      proof: bootstrapProof,
      userId: resolvedVerifyUserId,
      displayAlias: verify.displayAlias || '',
      isNewUser: Boolean(verify.isNewUser)
    })
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, data, 'KDC login bridge failed');
  }

  return data;
}

function normalizeJwtAlg(alg) {
  return String(alg || '').trim().toUpperCase();
}

async function importRsaVerifyKeyFromPem(publicKeyPem) {
  const body = String(publicKeyPem || '')
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');

  const der = base64ToBytes(body);

  return window.crypto.subtle.importKey(
    'spki',
    der,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['verify']
  );
}

async function verifyKdcChallengeSignature({ challengeValue, ts2, n1, signature }) {
  const signatureAlg = normalizeJwtAlg(signature && signature.alg);
  if (signatureAlg && signatureAlg !== 'RS256') {
    return false;
  }

  const signatureValueB64 = (signature && (signature.valueB64 || signature.value)) || '';
  if (!signatureValueB64 || !KDC_PUBLIC_KEY_PEM) {
    return false;
  }

  const signingInput = new TextEncoder().encode(`${challengeValue}.${ts2 || ''}.${n1 || ''}`);
  const verifyKey = await importRsaVerifyKeyFromPem(KDC_PUBLIC_KEY_PEM);
  return window.crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    verifyKey,
    base64ToBytes(signatureValueB64),
    signingInput
  );
}

async function decryptKdcAesEnvelope(envelope, keyBytes) {
  const normalized = {
    iv: envelope.iv || envelope.ivB64,
    ciphertext: envelope.ciphertext || envelope.ciphertextB64,
    authTag: envelope.authTag || envelope.tag || envelope.tagB64
  };

  if (!normalized.iv || !normalized.ciphertext || !normalized.authTag) {
    throw new Error('Invalid AES envelope from KDC');
  }

  return aesGcmDecrypt(normalized, keyBytes);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function concatBytes(...chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

async function deriveKeyEncryptionKey(username, password) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const salt = encoder.encode(`kdc-user-key:${username}`);
  const derivedBits = await window.crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt,
    iterations: 150000,
    hash: 'SHA-256'
  }, keyMaterial, 256);

  return new Uint8Array(derivedBits);
}

async function aesGcmEncrypt(plaintextBytes, keyBytes) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await window.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: AES_GCM_ALGORITHM },
    false,
    ['encrypt']
  );

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: AES_GCM_ALGORITHM, iv },
    key,
    plaintextBytes
  );

  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const tagLength = 16;
  const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - tagLength);
  const authTag = encryptedBytes.slice(encryptedBytes.length - tagLength);

  return {
    algorithm: 'aes-256-gcm',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    authTag: bytesToBase64(authTag)
  };
}

async function aesGcmDecrypt(payload, keyBytes) {
  const key = await window.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: AES_GCM_ALGORITHM },
    false,
    ['decrypt']
  );

  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const authTag = base64ToBytes(payload.authTag);
  const combined = concatBytes(ciphertext, authTag);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: AES_GCM_ALGORITHM, iv },
    key,
    combined
  );

  return new Uint8Array(decryptedBuffer);
}

function getUserWrapStorageKey(username) {
  return `${USER_KEY_STORAGE_PREFIX}${username}`;
}

function getActiveUserStorageKey(username) {
  return `${ACTIVE_USER_KEY_PREFIX}${username}`;
}

function getActiveConversationStorageKey(username, conversationId) {
  return `${ACTIVE_SESSION_KEY_PREFIX}${username}:${conversationId}`;
}

function getPendingTicketBStorageKey(username, conversationId) {
  return `${KDC_PENDING_TICKET_B_PREFIX}${username}:${conversationId}`;
}

export function getActiveUserKeyFromSession(username) {
  return sessionStorage.getItem(getActiveUserStorageKey(username));
}

export function getCachedConversationKey(username, conversationId) {
  return sessionStorage.getItem(getActiveConversationStorageKey(username, conversationId));
}

export function cacheConversationKey(username, conversationId, keyBase64) {
  sessionStorage.setItem(getActiveConversationStorageKey(username, conversationId), keyBase64);
}

export function getPendingSessionTicketB(username, conversationId) {
  const raw = sessionStorage.getItem(getPendingTicketBStorageKey(username, conversationId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

export function clearPendingSessionTicketB(username, conversationId) {
  sessionStorage.removeItem(getPendingTicketBStorageKey(username, conversationId));
}

export async function getKeyFingerprintBase64(keyBase64) {
  const digest = await sha256Bytes(base64ToBytes(String(keyBase64 || '')));
  return bytesToBase64(digest);
}

export function isDevBuild() {
  return IS_DEV;
}

export async function cacheConversationKeyFromTicketB({
  requesterUserId,
  conversationId,
  userKeyBase64,
  ticketBEnvelope
}) {
  const cached = getCachedConversationKey(requesterUserId, conversationId);
  if (cached) {
    return cached;
  }

  if (!ticketBEnvelope || !userKeyBase64) {
    return null;
  }

  if (IS_DEV) {
    const userKeyBytesLength = base64ToBytes(userKeyBase64).length;
    const envelopeIv = ticketBEnvelope.ivB64 || ticketBEnvelope.iv || '';
    const envelopeCiphertext = ticketBEnvelope.ciphertextB64 || ticketBEnvelope.ciphertext || '';
    const envelopeTag = ticketBEnvelope.tagB64 || ticketBEnvelope.authTag || ticketBEnvelope.tag || '';
    console.info('[kdc-dev] cacheConversationKeyFromTicketB inputs', {
      requesterUserId,
      conversationId,
      userKeyBytesLength,
      ticketBAlg: ticketBEnvelope.alg || 'unknown',
      ticketBIvB64Length: envelopeIv.length,
      ticketBCiphertextB64Length: envelopeCiphertext.length,
      ticketBTagB64Length: envelopeTag.length
    });
  }

  const ticketBBytes = await decryptKdcAesEnvelope(ticketBEnvelope, base64ToBytes(userKeyBase64));
  const ticketBPlaintext = new TextDecoder().decode(ticketBBytes);
  const parsedTicketB = JSON.parse(ticketBPlaintext);
  const sessionKeyBase64 = String((parsedTicketB && parsedTicketB.kConvB64) || '').trim();

  if (!sessionKeyBase64) {
    return null;
  }

  cacheConversationKey(requesterUserId, conversationId, sessionKeyBase64);
  return sessionKeyBase64;
}

async function importRsaPublicKeyFromPem(publicKeyPem) {
  const body = publicKeyPem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');

  const der = base64ToBytes(body);

  return window.crypto.subtle.importKey(
    'spki',
    der,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    false,
    ['encrypt']
  );
}

async function rsaEncryptBytes(publicKeyPem, plaintextBytes) {
  const publicKey = await importRsaPublicKeyFromPem(publicKeyPem);
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    plaintextBytes
  );
  const encryptedBytes = new Uint8Array(encryptedBuffer);
  return {
    valueB64: bytesToBase64(encryptedBytes),
    ciphertextBytes: encryptedBytes.length,
    modulusBits: Number((publicKey.algorithm && publicKey.algorithm.modulusLength) || 0)
  };
}

async function fetchKdcRegisterKeyMaterial() {
  if (registerKeyMaterialCache) {
    return registerKeyMaterialCache;
  }

  const normalizedPath = 'keys/public-key';
  const kdcToken = sessionStorage.getItem(KDC_AUTH_TOKEN_STORAGE_KEY) || '';
  const headers = {};
  if (kdcToken) {
    headers.Authorization = `Bearer ${kdcToken}`;
  }

  let keyUrl;
  let keySourceEndpoint;

  if (KDC_USE_BACKEND_PROXY) {
    keyUrl = `${API_URL}/keys/public-key`;
    keySourceEndpoint = '/api/keys/public-key';
  } else {
    const prefix = KDC_API_PREFIX
      ? `/${KDC_API_PREFIX.replace(/^\/+/, '').replace(/\/+$/, '')}`
      : '';

    let baseUrl = KDC_URL;
    if (prefix && baseUrl.endsWith(prefix)) {
      baseUrl = baseUrl.slice(0, -prefix.length);
    }

    keyUrl = `${baseUrl}${prefix}/${normalizedPath}`;
    keySourceEndpoint = `${prefix || '/api'}/keys/public-key`;
  }

  console.info(`KDC register-key key source endpoint: ${keySourceEndpoint}`);

  const response = await fetch(keyUrl, {
    method: 'GET',
    headers,
    credentials: KDC_USE_BACKEND_PROXY ? 'include' : undefined
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, data, `KDC key request failed (${response.status})`);
  }

  const algorithm = String((data && data.algorithm) || '').trim();
  const keyUse = String((data && data.use) || '').trim();
  const publicKeyPem = String((data && data.publicKeyPem) || '').trim();

  if (algorithm !== 'RSA-OAEP-256') {
    throw new Error(`Unsupported KDC key algorithm for register-key: ${algorithm || 'missing'}`);
  }

  if (keyUse !== 'enc') {
    throw new Error(`Unsupported KDC key use for register-key: ${keyUse || 'missing'}`);
  }

  if (!publicKeyPem) {
    throw new Error('KDC key response missing publicKeyPem');
  }

  registerKeyMaterialCache = {
    endpoint: keySourceEndpoint,
    algorithm,
    publicKeyPem
  };

  return registerKeyMaterialCache;
}

async function postKdc(path, body, options = {}) {
  const extraHeaders = options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)
    ? options.headers
    : {};

  if (!KDC_USE_BACKEND_PROXY && !KDC_URL) {
    throw new Error('KDC URL is not configured');
  }

  const normalizedPath = String(path || '').replace(/^\/+/, '');

  if (KDC_USE_BACKEND_PROXY) {
    const proxyUrl = `${API_URL}/kdc/${normalizedPath}`;
    const proxyResponse = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders
      },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    const proxyData = await parseJsonSafe(proxyResponse);
    if (!proxyResponse.ok) {
      throw createApiError(proxyResponse, proxyData, `KDC proxy request failed (${proxyResponse.status})`);
    }

    return proxyData || {};
  }

  const prefix = KDC_API_PREFIX
    ? `/${KDC_API_PREFIX.replace(/^\/+/, '').replace(/\/+$/, '')}`
    : '';

  let baseUrl = KDC_URL;
  if (prefix && baseUrl.endsWith(prefix)) {
    baseUrl = baseUrl.slice(0, -prefix.length);
  }

  const url = `${baseUrl}${prefix}/${normalizedPath}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw createApiError(response, data, `KDC request failed (${response.status})`);
  }

  return data || {};
}

export async function initializeUserKeyMaterial(username, password, isNewUser) {
  const existingWrapped = localStorage.getItem(getUserWrapStorageKey(username));
  const kekBytes = await deriveKeyEncryptionKey(username, password);

  if (existingWrapped && !isNewUser) {
    try {
      const wrappedPayload = JSON.parse(existingWrapped);
      const decryptedBytes = await aesGcmDecrypt(wrappedPayload, kekBytes);
      const userKeyBase64 = bytesToBase64(decryptedBytes);
      sessionStorage.setItem(getActiveUserStorageKey(username), userKeyBase64);
      return userKeyBase64;
    } catch (error) {
      localStorage.removeItem(getUserWrapStorageKey(username));
    }
  }

  const userKeyBytes = window.crypto.getRandomValues(new Uint8Array(AES_KEY_LENGTH_BYTES));
  const wrappedPayload = await aesGcmEncrypt(userKeyBytes, kekBytes);
  localStorage.setItem(getUserWrapStorageKey(username), JSON.stringify(wrappedPayload));

  const userKeyBase64 = bytesToBase64(userKeyBytes);
  sessionStorage.setItem(getActiveUserStorageKey(username), userKeyBase64);

  if ((KDC_USE_BACKEND_PROXY || KDC_URL) && !kdcRegisterKeyUnavailable) {
    try {
      if (userKeyBytes.length !== AES_KEY_LENGTH_BYTES) {
        throw new Error(`User key byte length mismatch: expected ${AES_KEY_LENGTH_BYTES}, got ${userKeyBytes.length}`);
      }

      const keyMaterial = await fetchKdcRegisterKeyMaterial();
      const encryptedUserKeyResult = await rsaEncryptBytes(keyMaterial.publicKeyPem, userKeyBytes);
      const encryptedUserKey = encryptedUserKeyResult.valueB64;
      const decodedCiphertextBytes = base64ToBytes(encryptedUserKey).length;
      const expectedCiphertextBytes = encryptedUserKeyResult.modulusBits > 0
        ? Math.ceil(encryptedUserKeyResult.modulusBits / 8)
        : 0;

      console.info(`KDC register-key algorithm used: ${keyMaterial.algorithm}`);
      console.info(`KDC register-key ciphertext decoded byte length: ${decodedCiphertextBytes}`);

      if (!expectedCiphertextBytes || decodedCiphertextBytes !== expectedCiphertextBytes) {
        throw new Error(
          `encryptedUserKey preflight length mismatch: expected ${expectedCiphertextBytes}, got ${decodedCiphertextBytes}`
        );
      }

      const kdcToken = sessionStorage.getItem(KDC_AUTH_TOKEN_STORAGE_KEY) || '';
      const kdcHeaders = kdcToken
        ? { Authorization: `Bearer ${kdcToken}` }
        : {};
      await postKdc('register-key', {
        protocolVersion: KDC_KEY_PROTOCOL_VERSION,
        userId: username,
        encryptedUserKey
      }, {
        headers: kdcHeaders
      });
    } catch (error) {
      const detailMessage = String(
        (error && error.details && error.details.error && error.details.error.message) || ''
      ).toLowerCase();

      if (error && (error.status === 404 || error.status === 405)) {
        kdcRegisterKeyUnavailable = true;
      }

      if (error && error.status === 400 && detailMessage.includes('encrypteduserkey must decode to 384 bytes')) {
        kdcRegisterKeyUnavailable = true;
      }

      const suppressKnownCiphertextLengthWarning = Boolean(
        error
        && error.status === 400
        && detailMessage.includes('encrypteduserkey must decode to')
      );

      if (!suppressKnownCiphertextLengthWarning && !hasLoggedRegisterKeyFailure) {
        hasLoggedRegisterKeyFailure = true;
        console.warn(`KDC register-key failed (${error.message}); continuing with local key material only.`);
      }
    }
  }

  return userKeyBase64;
}

export async function ensureConversationSessionKey({
  requesterUserId,
  peerUserId,
  conversationId,
  userKeyBase64,
  allowCreate = true
}) {
  const cached = getCachedConversationKey(requesterUserId, conversationId);
  if (cached) {
    return cached;
  }

  if (!allowCreate) {
    return null;
  }

  if ((KDC_USE_BACKEND_PROXY || KDC_URL) && !kdcCreateSessionUnavailable) {
    try {
      const kdcToken = sessionStorage.getItem(KDC_AUTH_TOKEN_STORAGE_KEY) || '';
      const clientServerKeyBase64 = sessionStorage.getItem(KDC_CLIENT_SERVER_KEY_STORAGE_KEY) || '';
      const kdcHeaders = kdcToken
        ? { Authorization: `Bearer ${kdcToken}` }
        : {};
      const ts1 = Date.now();
      const n1 = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
      if (IS_DEV) {
        console.info('[kdc-dev] create-session request', {
          requesterUserId,
          peerUserId,
          conversationId,
          hasClientServerKey: Boolean(clientServerKeyBase64),
          userKeyBytesLength: userKeyBase64 ? base64ToBytes(userKeyBase64).length : 0
        });
      }
      const response = await postKdc('create-session', {
        protocolVersion: 'kdc-session-v2',
        tokenA: kdcToken,
        idB: peerUserId,
        ts1,
        n1,
        userIdA: requesterUserId,
        userIdB: peerUserId,
        requesterUserId,
        conversationId
      }, {
        headers: kdcHeaders
      });

      if (response.ticketA && clientServerKeyBase64) {
        const ticketABytes = await decryptKdcAesEnvelope(response.ticketA, base64ToBytes(clientServerKeyBase64));
        const ticketAPlaintext = new TextDecoder().decode(ticketABytes);
        const parsedTicketA = JSON.parse(ticketAPlaintext);
        const sessionKeyBase64 = parsedTicketA.kConvB64 || '';

        if (sessionKeyBase64) {
          if (IS_DEV) {
            console.info('[kdc-dev] create-session response summary', {
              requesterUserId,
              peerUserId,
              conversationId,
              hasTicketA: Boolean(response.ticketA),
              hasTicketB: Boolean(response.ticketB)
            });
          }
          cacheConversationKey(requesterUserId, conversationId, sessionKeyBase64);
          if (response.ticketB) {
            sessionStorage.setItem(getPendingTicketBStorageKey(requesterUserId, conversationId), JSON.stringify(response.ticketB));
          }
          return sessionKeyBase64;
        }
      }
    } catch (error) {
      if (error && (error.status === 404 || error.status === 405)) {
        kdcCreateSessionUnavailable = true;
      }
      if (!hasLoggedCreateSessionFailure) {
        hasLoggedCreateSessionFailure = true;
        console.warn(`KDC create-session failed (${error.message}).`);
      }
    }
  }

  throw new Error('KDC create-session failed');
}

export async function encryptChatMessage(plaintext, sessionKeyBase64) {
  const encoder = new TextEncoder();
  return aesGcmEncrypt(encoder.encode(plaintext), base64ToBytes(sessionKeyBase64));
}

export async function decryptChatMessage(encryptedPayload, sessionKeyBase64) {
  const decoder = new TextDecoder();
  const decryptedBytes = await aesGcmDecrypt(encryptedPayload, base64ToBytes(sessionKeyBase64));
  return decoder.decode(decryptedBytes);
}

async function parseJsonSafe(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function createApiError(response, data, fallbackMessage) {
  const details = data
    ? (typeof data === 'string' ? data : JSON.stringify(data))
    : '';
  const baseMessage = (data && data.error) || fallbackMessage || `Request failed (${response.status})`;
  const error = new Error(details && details !== baseMessage ? `${baseMessage}: ${details}` : baseMessage);
  error.status = response.status;
  error.details = data;
  return error;
}

// Get current session status
export async function getSession() {
  try {
    const response = await fetch(`${API_URL}/session`, {
      credentials: 'include'
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to fetch session');
    }

    return data || { loggedIn: false };
  } catch (error) {
    console.error('Error fetching session:', error);
    return { loggedIn: false };
  }
}

// Login or register user
export async function loginUser(username, password) {
  if (KDC_AUTH_ENABLED) {
    return performKdcAuthLogin(username, password);
  }

  try {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Login failed');
    }

    return data;
  } catch (error) {
    throw error;
  }
}

// Logout user
export async function logoutUser() {
  try {
    const response = await fetch(`${API_URL}/logout`, {
      method: 'POST',
      credentials: 'include'
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Logout failed');
    }

    clearAllKdcSessionState();

    return data || { success: true };
  } catch (error) {
    console.error('Error logging out:', error);
    throw error;
  }
}

// Get all users available for direct messages
export async function getUsers() {
  try {
    const response = await fetch(`${API_URL}/users`, {
      credentials: 'include'
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to fetch users');
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
}

// Get all direct-message conversations for current user
export async function getConversations() {
  try {
    const response = await fetch(`${API_URL}/conversations`, {
      credentials: 'include'
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to fetch conversations');
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching conversations:', error);
    throw error;
  }
}

// Create or get a direct conversation with another user
export async function openConversation(targetUserId) {
  try {
    const response = await fetch(`${API_URL}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ targetUserId })
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to open conversation');
    }

    return data;
  } catch (error) {
    console.error('Error opening conversation:', error);
    throw error;
  }
}

// Get all messages for one conversation
export async function getConversationMessages(conversationId) {
  try {
    const response = await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
      credentials: 'include'
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to fetch conversation messages');
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching conversation messages:', error);
    throw error;
  }
}

// Send a direct message to one conversation
export async function sendConversationMessage(conversationId, payload) {
  try {
    const response = await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to send message');
    }

    return data;
  } catch (error) {
    console.error('Error sending conversation message:', error);
    throw error;
  }
}

// Reset all data (admin only)
export async function resetData() {
  try {
    const response = await fetch(`${API_URL}/admin/reset`, {
      method: 'POST',
      credentials: 'include'
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Reset failed');
    }

    return data || { success: true };
  } catch (error) {
    console.error('Error resetting data:', error);
    throw error;
  }
}

// Fetch personal activity logs
export async function getPersonalActivityLogs() {
  try {
    const response = await fetch(`${API_URL}/profile/activity-logs`, {
      credentials: 'include'
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to fetch audit logs');
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    throw error;
  }
}

// Update current user's display name
export async function updateDisplayName(displayName) {
  try {
    const response = await fetch(`${API_URL}/profile/display-name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ displayName })
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      throw createApiError(response, data, 'Failed to update display name');
    }

    return data || { success: true, displayName };
  } catch (error) {
    console.error('Error updating display name:', error);
    throw error;
  }
}
