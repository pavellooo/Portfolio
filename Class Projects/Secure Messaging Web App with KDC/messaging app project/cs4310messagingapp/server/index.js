const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const MemoryStore = require('memorystore')(session);
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { eventTypes, initAuditLogModel, recordAuditEvent, getAuditLogRequestContext, getAuditLogs } = require('./audit');

const app = express();
const PORT = process.env.PORT || 5001;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-key';
const MONGODB_URI = process.env.MONGODB_URI;
const USE_MONGODB = (process.env.USE_MONGODB || 'auto').trim().toLowerCase();
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PASSWORD_PEPPER = process.env.PASSWORD_PEPPER || '';
const ALLOW_RESET = process.env.ALLOW_RESET === 'true';
const ALLOW_INSECURE_SESSION = process.env.ALLOW_INSECURE_SESSION === 'true';
const KDC_PROXY_URL = (process.env.KDC_PROXY_URL || 'http://localhost:4000').replace(/\/+$/, '');
const KDC_PROXY_API_PREFIX = String(process.env.KDC_PROXY_API_PREFIX || '/api').trim();
const KDC_AUTH_JWT_PUBLIC_KEY_PEM = (process.env.KDC_AUTH_JWT_PUBLIC_KEY_PEM || process.env.KDC_AUTH_PUBLIC_KEY_PEM || '').replace(/\\n/g, '\n');
const KDC_AUTH_JWT_ISSUER = String(process.env.KDC_AUTH_JWT_ISSUER || '').trim();
const KDC_AUTH_JWT_AUDIENCE = String(process.env.KDC_AUTH_JWT_AUDIENCE || '').trim();
function resolveUseDatabase() {
  if (USE_MONGODB === 'true' || USE_MONGODB === '1' || USE_MONGODB === 'yes') {
    return true;
  }

  if (USE_MONGODB === 'false' || USE_MONGODB === '0' || USE_MONGODB === 'no') {
    return false;
  }

  return Boolean(MONGODB_URI);
}

const useDatabase = resolveUseDatabase();
const USERNAME_MAX_LENGTH = 32;
const DISPLAY_NAME_MAX_LENGTH = 64;
const PASSWORD_MAX_LENGTH = 128;
const MESSAGE_MAX_LENGTH = 1000;
const PASSWORD_MIN_LENGTH = 8;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const MESSAGE_WINDOW_MS = 60 * 1000;
const MAX_MESSAGES_PER_WINDOW = 20;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_VERSION = 'v1';
const LOGIN_ID_HMAC_SECRET = process.env.LOGIN_ID_HMAC_SECRET || SESSION_SECRET;

if (process.env.NODE_ENV === 'production') {
  if (!MONGODB_URI) {
    console.warn('Production is running without MONGODB_URI. Data will be ephemeral and sessions will reset on restart.');
  }

  if (ALLOW_RESET) {
    console.warn('ALLOW_RESET is enabled in production. Set ALLOW_RESET=false for any real deployment.');
  }
}

const ALIAS_WORDS_ONE = ['amber', 'brisk', 'cobalt', 'dawn', 'ember', 'frost', 'golden', 'harbor', 'iris', 'jade', 'lunar', 'mellow'];
const ALIAS_WORDS_TWO = ['otter', 'falcon', 'maple', 'comet', 'meadow', 'river', 'cedar', 'violet', 'summit', 'panda', 'phoenix', 'spruce'];

function hashLoginIdentifier(loginIdentifier) {
  return crypto
    .createHmac('sha256', LOGIN_ID_HMAC_SECRET)
    .update(loginIdentifier)
    .digest('hex');
}

function normalizeLoginIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDisplayName(value, fallbackValue = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return String(fallbackValue || '').trim();
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
  }
  return trimmed;
}

function canonicalizeDisplayName(value) {
  return normalizeDisplayName(value).toLowerCase();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toBase64Url(base64Value) {
  return String(base64Value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBuffer(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(Buffer.from(buffer).toString('utf8'));
  } catch (error) {
    return null;
  }
}

function verifyKdcJwtToken(token) {
  if (!KDC_AUTH_JWT_PUBLIC_KEY_PEM) {
    throw new Error('KDC auth public key is not configured');
  }

  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonBuffer(base64UrlToBuffer(encodedHeader));
  const payload = parseJsonBuffer(base64UrlToBuffer(encodedPayload));

  if (!header || !payload) {
    throw new Error('Invalid JWT payload');
  }

  if (header.alg !== 'RS256') {
    throw new Error('Unsupported JWT algorithm');
  }

  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(`${encodedHeader}.${encodedPayload}`);
  verify.end();

  const validSignature = verify.verify(KDC_AUTH_JWT_PUBLIC_KEY_PEM, base64UrlToBuffer(encodedSignature));
  if (!validSignature) {
    throw new Error('Invalid KDC token signature');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('KDC token is expired');
  }

  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    throw new Error('KDC token is not yet valid');
  }

  if (KDC_AUTH_JWT_ISSUER && payload.iss !== KDC_AUTH_JWT_ISSUER) {
    throw new Error('KDC token issuer mismatch');
  }

  if (KDC_AUTH_JWT_AUDIENCE) {
    const audience = payload.aud;
    const matchesAudience = Array.isArray(audience)
      ? audience.includes(KDC_AUTH_JWT_AUDIENCE)
      : audience === KDC_AUTH_JWT_AUDIENCE;

    if (!matchesAudience) {
      throw new Error('KDC token audience mismatch');
    }
  }

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('KDC token missing subject');
  }

  return payload;
}

function computeOpaqueLoginId(loginIdentifier) {
  const normalized = normalizeLoginIdentifier(loginIdentifier);
  if (!normalized) {
    return '';
  }

  const digestBase64 = crypto
    .createHash('sha256')
    .update(`login-id:v1:${normalized}`)
    .digest('base64');

  return toBase64Url(digestBase64);
}

function getLoginIdHashCandidates(loginIdentifier) {
  const normalized = normalizeLoginIdentifier(loginIdentifier);
  if (!normalized) {
    return [];
  }

  const opaqueLoginId = computeOpaqueLoginId(normalized);
  const candidates = [
    hashLoginIdentifier(normalized)
  ];

  if (opaqueLoginId && opaqueLoginId !== normalized) {
    candidates.unshift(hashLoginIdentifier(opaqueLoginId));
  }

  return [...new Set(candidates)];
}

function generateUserId() {
  return `u_${crypto.randomBytes(8).toString('hex')}`;
}

function generateDisplayAlias() {
  const first = ALIAS_WORDS_ONE[Math.floor(Math.random() * ALIAS_WORDS_ONE.length)];
  const second = ALIAS_WORDS_TWO[Math.floor(Math.random() * ALIAS_WORDS_TWO.length)];
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${first}-${second}-${suffix}`;
}

function resolveBcryptRounds() {
  const fallbackRounds = 12;
  const minRounds = 10;
  const maxRounds = 14;
  const parsed = Number.parseInt(process.env.BCRYPT_COST || '', 10);

  if (Number.isNaN(parsed)) {
    return fallbackRounds;
  }

  if (parsed < minRounds || parsed > maxRounds) {
    console.warn(`BCRYPT_COST out of range (${minRounds}-${maxRounds}). Falling back to ${fallbackRounds}.`);
    return fallbackRounds;
  }

  return parsed;
}

const BCRYPT_ROUNDS = resolveBcryptRounds();

let User;
let Conversation;
let Message;

if (useDatabase) {
  const userSchema = new mongoose.Schema({
    // Legacy compatibility: older deployments used `username` with a unique index.
    // Keep this field populated to avoid duplicate-null insert failures.
    username: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    loginIdHash: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    passwordHash: {
      type: String,
      default: ''
    },
    displayAlias: {
      type: String,
      trim: true,
      default: ''
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    }
  }, { timestamps: true });

  const messageSchema = new mongoose.Schema({
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Conversation'
    },
    senderUsername: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    ciphertext: {
      type: String,
      required: true,
      trim: true
    },
    iv: {
      type: String,
      required: true
    },
    authTag: {
      type: String,
      required: true
    },
    algorithm: {
      type: String,
      required: true,
      default: ENCRYPTION_ALGORITHM
    },
    keyVersion: {
      type: String,
      required: true,
      default: ENCRYPTION_KEY_VERSION
    },
    kdcTicketB: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  });

  const conversationSchema = new mongoose.Schema({
    participants: {
      type: [String],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: 'Conversation must have exactly 2 participants'
      }
    },
    participantKey: {
      type: String,
      required: true,
      unique: true
    },
    lastMessageAt: {
      type: Date,
      default: Date.now
    }
  }, { timestamps: true });

  conversationSchema.index({ participants: 1 });

  User = mongoose.model('User', userSchema);
  Conversation = mongoose.model('Conversation', conversationSchema);
  Message = mongoose.model('Message', messageSchema);
  initAuditLogModel(mongoose);
}

// Middleware
// Configure CORS based on environment
const corsOptions = {
  credentials: true
};

if (process.env.NODE_ENV === 'production' && !ALLOW_INSECURE_SESSION) {
  // In production, we serve static files from the same origin, so we don't need CORS
  corsOptions.origin = false;
} else {
  // In development, allow localhost:3000 (React dev server)
  corsOptions.origin = 'http://localhost:3000';
}

app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Session store setup
// - Production/scalable path: use MongoDB-backed sessions when MONGODB_URI is set
// - Local fallback: use memorystore to avoid default MemoryStore leak warnings
let sessionStore;

if (useDatabase) {
  sessionStore = MongoStore.create({
    mongoUrl: MONGODB_URI,
    collectionName: 'sessions'
  });
  console.log('Using MongoDB session store and database models.');
} else {
  sessionStore = new MemoryStore({
    checkPeriod: 1000 * 60 * 60 * 24
  });
  console.log('Using local memory session store and in-memory app data (development fallback).');
}

// Session middleware
app.use(session({
  secret: SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Use secure cookies for real production deployments; allow HTTP cookies for local fallback testing.
    secure: process.env.NODE_ENV === 'production' && !ALLOW_INSECURE_SESSION,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// ============================================================
// In-memory fallback storage (used only when MONGODB_URI is not set)
// ============================================================
const users = {}; // { loginIdHash -> { userId, loginIdHash, passwordHash, role } }
const conversations = []; // Array of { id, participants(userIds), participantKey, createdAt, lastMessageAt }
const directMessages = []; // Array of encrypted payloads tied to conversationId
const failedLoginAttempts = new Map(); // { loginIdHash -> { count, windowStartedAt } }
const messageRateLimits = new Map(); // { userId -> { count, windowStartedAt } }
let conversationCounter = 1;

function buildKdcProxyTarget(pathSuffix) {
  const normalizedPath = String(pathSuffix || '').replace(/^\/+/, '');
  const prefix = KDC_PROXY_API_PREFIX
    ? `/${KDC_PROXY_API_PREFIX.replace(/^\/+/, '').replace(/\/+$/, '')}`
    : '';

  return `${KDC_PROXY_URL}${prefix}/${normalizedPath}`;
}

function getSetCookieHeaders(headers) {
  if (!headers) {
    return [];
  }

  // Undici (Node fetch) exposes getSetCookie in newer runtimes.
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const single = headers.get('set-cookie');
  if (!single) {
    return [];
  }

  return [single];
}

async function verifyKdcBootstrapProof({ token, ts5, n3, proof }) {
  const target = buildKdcProxyTarget('auth/bootstrap-verify');
  const upstream = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
    protocolVersion: 'kdc-auth-v2',
    ts5,
    n3,
    proof
    })
  });

  const contentType = upstream.headers.get('content-type') || '';
  const rawBody = await upstream.text();
  let payload = null;
  if (contentType.includes('application/json')) {
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch (error) {
      payload = null;
    }
  }

  if (!upstream.ok) {
    const failureMessage = payload && payload.error
      ? payload.error
      : `KDC bootstrap verification failed (${upstream.status})`;
    throw new Error(failureMessage);
  }

  if (!payload || payload.success !== true) {
    throw new Error('KDC bootstrap verification rejected proof');
  }

  return payload;
}

function applyPasswordPepper(password) {
  if (!PASSWORD_PEPPER) {
    return password;
  }
  return `${password}${PASSWORD_PEPPER}`;
}

async function hashPassword(password) {
  return bcrypt.hash(applyPasswordPepper(password), BCRYPT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  const pepperedMatch = await bcrypt.compare(applyPasswordPepper(password), passwordHash);
  if (pepperedMatch) {
    return true;
  }

  if (PASSWORD_PEPPER) {
    // Backward compatibility: allow existing non-peppered hashes.
    return bcrypt.compare(password, passwordHash);
  }

  return false;
}

function buildFallbackLegacyUsername(userId) {
  const normalized = String(userId || '').trim().toLowerCase();
  if (normalized) {
    return `legacy-${normalized}`;
  }
  return `legacy-${crypto.randomBytes(4).toString('hex')}`;
}

async function ensureAdminAccount() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return;
  }

  const normalizedAdmin = normalizeLoginIdentifier(ADMIN_USERNAME);
  const opaqueAdminLoginId = computeOpaqueLoginId(normalizedAdmin);
  const preferredAdminLoginId = opaqueAdminLoginId || normalizedAdmin;
  const preferredAdminLoginIdHash = hashLoginIdentifier(preferredAdminLoginId);
  const adminHashCandidates = getLoginIdHashCandidates(normalizedAdmin);

  if (useDatabase) {
    let existingAdmin = await User.findOne({
      role: 'admin',
      loginIdHash: { $in: adminHashCandidates }
    });

    if (!existingAdmin) {
      existingAdmin = await User.findOne({ loginIdHash: preferredAdminLoginIdHash, role: 'admin' });
    }

    if (!existingAdmin) {
      const userId = generateUserId();
      let legacyUsername = normalizedAdmin;
      const usernameConflict = await User.findOne({ username: legacyUsername });
      if (usernameConflict) {
        legacyUsername = buildFallbackLegacyUsername(userId);
      }

      const passwordHash = await hashPassword(ADMIN_PASSWORD);
      await User.create({
        username: legacyUsername,
        userId,
        loginIdHash: preferredAdminLoginIdHash,
        passwordHash,
        displayAlias: normalizeDisplayName(ADMIN_USERNAME, 'Admin'),
        role: 'admin'
      });
      console.log('Seeded admin account.');
    } else {
      if (existingAdmin.loginIdHash !== preferredAdminLoginIdHash) {
        const conflictingUser = await User.findOne({ loginIdHash: preferredAdminLoginIdHash });
        if (!conflictingUser) {
          existingAdmin.loginIdHash = preferredAdminLoginIdHash;
          console.log('Migrated admin account to opaque login identifier mapping.');
        }
      }

      if (!String(existingAdmin.username || '').trim()) {
        let legacyUsername = normalizedAdmin;
        const usernameConflict = await User.findOne({
          username: legacyUsername,
          _id: { $ne: existingAdmin._id }
        });
        if (usernameConflict) {
          legacyUsername = buildFallbackLegacyUsername(existingAdmin.userId);
        }
        existingAdmin.username = legacyUsername;
        console.log('Updated admin account with legacy username for index compatibility.');
      }

      if (!String(existingAdmin.displayAlias || '').trim()) {
        existingAdmin.displayAlias = normalizeDisplayName(ADMIN_USERNAME, 'Admin');
      }

      await existingAdmin.save();
    }
    return;
  }

  const existingLocalAdmin = adminHashCandidates
    .map((hash) => users[hash])
    .find((entry) => Boolean(entry && entry.role === 'admin'));

  if (!existingLocalAdmin) {
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    users[preferredAdminLoginIdHash] = {
      userId: generateUserId(),
      loginIdHash: preferredAdminLoginIdHash,
      passwordHash,
      displayAlias: normalizeDisplayName(ADMIN_USERNAME, 'Admin'),
      role: 'admin'
    };
    console.log('Seeded local admin account.');
    return;
  }

  if (existingLocalAdmin.loginIdHash !== preferredAdminLoginIdHash) {
    adminHashCandidates.forEach((hash) => {
      if (users[hash] === existingLocalAdmin) {
        delete users[hash];
      }
    });

    existingLocalAdmin.loginIdHash = preferredAdminLoginIdHash;
    users[preferredAdminLoginIdHash] = existingLocalAdmin;
    console.log('Migrated local admin account to opaque login identifier mapping.');
  }

  if (!String(existingLocalAdmin.displayAlias || '').trim()) {
    existingLocalAdmin.displayAlias = normalizeDisplayName(ADMIN_USERNAME, 'Admin');
  }
}

async function initializeAppData() {
  try {
    if (useDatabase) {
      await mongoose.connect(MONGODB_URI);
      console.log('Connected to MongoDB.');
    }

    await ensureAdminAccount();
  } catch (err) {
    console.error('Startup initialization failed:', err);
    process.exit(1);
  }
}

async function getUserByLoginIdentifier(loginIdentifier) {
  const loginIdHashCandidates = getLoginIdHashCandidates(loginIdentifier);

  if (!loginIdHashCandidates.length) {
    return null;
  }

  if (useDatabase) {
    return User.findOne({ loginIdHash: { $in: loginIdHashCandidates } });
  }

  for (const candidate of loginIdHashCandidates) {
    if (users[candidate]) {
      return users[candidate];
    }
  }

  return null;
}

async function getUserById(userId) {
  if (useDatabase) {
    return User.findOne({ userId });
  }

  return Object.values(users).find((user) => user.userId === userId) || null;
}

async function createUser(loginIdentifier, passwordHash) {
  const normalizedLoginIdentifier = loginIdentifier.toLowerCase();
  const loginIdHash = hashLoginIdentifier(normalizedLoginIdentifier);
  const userId = generateUserId();
  const displayAlias = await ensureUniqueDisplayName(loginIdentifier, normalizedLoginIdentifier, userId);

  if (useDatabase) {
    return User.create({
      username: normalizedLoginIdentifier,
      userId,
      loginIdHash,
      passwordHash,
      displayAlias,
      role: 'user'
    });
  }

  users[loginIdHash] = {
    userId,
    loginIdHash,
    passwordHash,
    displayAlias,
    role: 'user'
  };

  return users[loginIdHash];
}

async function upsertUserFromKdcIdentity({ userId, loginId, displayAlias }) {
  const loginIdHash = hashLoginIdentifier(String(loginId || ''));
  const resolvedAlias = await ensureUniqueDisplayName(displayAlias, generateDisplayAlias(), userId);
  const normalizedUserId = String(userId || '').trim().toLowerCase();

  if (useDatabase) {
    let user = await User.findOne({ userId });
    if (!user && loginIdHash) {
      user = await User.findOne({ loginIdHash });
    }

    if (!user) {
      user = await User.create({
        username: normalizedUserId,
        userId,
        loginIdHash,
        passwordHash: '',
        displayAlias: resolvedAlias,
        role: 'user'
      });
      return user;
    }

    user.loginIdHash = user.loginIdHash || loginIdHash;
    user.username = user.username || normalizedUserId;
    if (resolvedAlias && canonicalizeDisplayName(user.displayAlias) !== canonicalizeDisplayName(resolvedAlias)) {
      user.displayAlias = resolvedAlias;
    }
    await user.save();
    return user;
  }

  let user = Object.values(users).find((entry) => entry.userId === userId)
    || (loginIdHash ? users[loginIdHash] : null);

  if (!user) {
    const record = {
      userId,
      loginIdHash,
      passwordHash: '',
      displayAlias: resolvedAlias,
      role: 'user'
    };
    users[loginIdHash] = record;
    return record;
  }

  user.loginIdHash = user.loginIdHash || loginIdHash;
  if (resolvedAlias && canonicalizeDisplayName(user.displayAlias) !== canonicalizeDisplayName(resolvedAlias)) {
    user.displayAlias = resolvedAlias;
  }

  if (loginIdHash && !users[loginIdHash]) {
    users[loginIdHash] = user;
  }

  return user;
}

function normalizeConversationParticipants(userIdA, userIdB) {
  const a = userIdA.trim();
  const b = userIdB.trim();

  if (!a || !b) {
    return { error: 'Both participants are required' };
  }

  if (a === b) {
    return { error: 'Cannot create a conversation with yourself' };
  }

  const participants = [a, b].sort();
  return {
    participants,
    participantKey: participants.join('::')
  };
}

function toConversationResponse(conversation, currentUserId, displayNameByUserId = {}) {
  const otherUserId = conversation.participants.find((participant) => participant !== currentUserId) || '';
  const otherDisplayName = displayNameByUserId[otherUserId] || otherUserId;
  return {
    id: String(conversation.id || conversation._id),
    participants: conversation.participants,
    otherUserId,
    otherUsername: otherUserId,
    otherDisplayName,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt
  };
}

async function getAllUsersSummary() {
  if (useDatabase) {
    const docs = await User.find({}, { userId: 1, displayAlias: 1, _id: 0 }).sort({ userId: 1 });
    return docs.map((doc) => ({
      userId: doc.userId,
      displayName: normalizeDisplayName(doc.displayAlias, doc.userId)
    }));
  }

  const byUserId = new Map();
  Object.values(users).forEach((user) => {
    if (!user || !user.userId || byUserId.has(user.userId)) {
      return;
    }
    byUserId.set(user.userId, {
      userId: user.userId,
      displayName: normalizeDisplayName(user.displayAlias, user.userId)
    });
  });

  return Array.from(byUserId.values()).sort((a, b) => a.userId.localeCompare(b.userId));
}

async function isDisplayNameTaken(displayName, excludingUserId = '') {
  const normalizedName = normalizeDisplayName(displayName);
  if (!normalizedName) {
    return false;
  }

  const excluded = String(excludingUserId || '').trim();

  if (useDatabase) {
    const query = {
      displayAlias: {
        $regex: new RegExp(`^${escapeRegex(normalizedName)}$`, 'i')
      }
    };

    if (excluded) {
      query.userId = { $ne: excluded };
    }

    const existing = await User.findOne(query, { _id: 1 });
    return Boolean(existing);
  }

  const nameKey = canonicalizeDisplayName(normalizedName);
  const seenUserIds = new Set();
  return Object.values(users).some((entry) => {
    if (!entry || !entry.userId || seenUserIds.has(entry.userId)) {
      return false;
    }

    seenUserIds.add(entry.userId);

    if (excluded && entry.userId === excluded) {
      return false;
    }

    return canonicalizeDisplayName(entry.displayAlias) === nameKey;
  });
}

async function ensureUniqueDisplayName(displayName, fallbackName, userId = '') {
  const base = normalizeDisplayName(displayName, fallbackName) || generateDisplayAlias();
  const excluded = String(userId || '').trim();

  if (!(await isDisplayNameTaken(base, excluded))) {
    return base;
  }

  for (let attempt = 2; attempt <= 9999; attempt += 1) {
    const suffix = `-${attempt}`;
    const headLength = Math.max(1, DISPLAY_NAME_MAX_LENGTH - suffix.length);
    const candidate = `${base.slice(0, headLength)}${suffix}`;

    if (!(await isDisplayNameTaken(candidate, excluded))) {
      return candidate;
    }
  }

  let generated;
  do {
    generated = generateDisplayAlias();
  } while (await isDisplayNameTaken(generated, excluded));

  return generated;
}

async function findOrCreateConversation(userA, userB) {
  const normalized = normalizeConversationParticipants(userA, userB);
  if (normalized.error) {
    throw new Error(normalized.error);
  }

  if (useDatabase) {
    let conversation = await Conversation.findOne({ participantKey: normalized.participantKey });
    if (!conversation) {
      conversation = await Conversation.create({
        participants: normalized.participants,
        participantKey: normalized.participantKey,
        lastMessageAt: new Date()
      });
    }
    return conversation;
  }

  let conversation = conversations.find((item) => item.participantKey === normalized.participantKey);
  if (!conversation) {
    const now = new Date().toISOString();
    conversation = {
      id: String(conversationCounter++),
      participants: normalized.participants,
      participantKey: normalized.participantKey,
      createdAt: now,
      lastMessageAt: now
    };
    conversations.push(conversation);
  }

  return conversation;
}

async function getConversationByIdForUser(conversationId, userId) {
  const normalizedUserId = String(userId || '').trim();

  if (useDatabase) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return null;
    }

    return Conversation.findOne({
      _id: conversationId,
      participants: normalizedUserId
    });
  }

  return conversations.find(
    (conversation) => String(conversation.id) === String(conversationId)
      && conversation.participants.includes(normalizedUserId)
  ) || null;
}

async function getConversationsForUser(userId) {
  const normalizedUserId = String(userId || '').trim();
  const userSummary = await getAllUsersSummary();
  const displayNameByUserId = userSummary.reduce((acc, item) => {
    acc[item.userId] = item.displayName;
    return acc;
  }, {});

  if (useDatabase) {
    const docs = await Conversation
      .find({ participants: normalizedUserId })
      .sort({ lastMessageAt: -1, createdAt: -1 });
    return docs.map((doc) => toConversationResponse(doc, normalizedUserId, displayNameByUserId));
  }

  return conversations
    .filter((conversation) => conversation.participants.includes(normalizedUserId))
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    .map((conversation) => toConversationResponse(conversation, normalizedUserId, displayNameByUserId));
}

async function getMessagesForConversation(conversationId, userId) {
  const conversation = await getConversationByIdForUser(conversationId, userId);
  if (!conversation) {
    return null;
  }

  const resolvedConversationId = String(conversation.id || conversation._id);
  const userSummary = await getAllUsersSummary();
  const displayNameByUserId = userSummary.reduce((acc, item) => {
    acc[item.userId] = item.displayName;
    return acc;
  }, {});

  if (useDatabase) {
    const docs = await Message.find({ conversationId: conversation._id }).sort({ timestamp: 1 });
    return docs.map((doc) => ({
      id: String(doc._id),
      conversationId: resolvedConversationId,
      senderUsername: doc.senderUsername,
      senderUserId: doc.senderUsername,
      senderDisplayName: displayNameByUserId[doc.senderUsername] || doc.senderUsername,
      encrypted: {
        algorithm: doc.algorithm,
        iv: doc.iv,
        authTag: doc.authTag,
        ciphertext: doc.ciphertext
      },
      kdcTicketB: doc.kdcTicketB || null,
      timestamp: doc.timestamp
    }));
  }

  return directMessages
    .filter((message) => String(message.conversationId) === resolvedConversationId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((message) => ({
      id: String(message.id),
      conversationId: resolvedConversationId,
      senderUsername: message.senderUsername,
      senderUserId: message.senderUsername,
      senderDisplayName: displayNameByUserId[message.senderUsername] || message.senderUsername,
      encrypted: {
        algorithm: message.algorithm,
        iv: message.iv,
        authTag: message.authTag,
        ciphertext: message.ciphertext
      },
      kdcTicketB: message.kdcTicketB || null,
      timestamp: message.timestamp
    }));
}

async function createConversationMessage(conversationId, senderUserId, payload) {
  const conversation = await getConversationByIdForUser(conversationId, senderUserId);
  if (!conversation) {
    return null;
  }

  const resolvedConversationId = String(conversation.id || conversation._id);
  const encrypted = payload.encrypted;
  const senderUser = await getUserById(senderUserId);
  const senderDisplayName = normalizeDisplayName(senderUser && senderUser.displayAlias, senderUserId);

  if (useDatabase) {
    const doc = await Message.create({
      conversationId: conversation._id,
      senderUsername: senderUserId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      algorithm: encrypted.algorithm,
      keyVersion: encrypted.keyVersion,
      kdcTicketB: payload.kdcTicketB || null,
      timestamp: new Date()
    });

    conversation.lastMessageAt = doc.timestamp;
    await conversation.save();

    return {
      id: String(doc._id),
      conversationId: resolvedConversationId,
      senderUsername: doc.senderUsername,
      senderUserId: doc.senderUsername,
      senderDisplayName,
      encrypted: {
        algorithm: doc.algorithm,
        iv: doc.iv,
        authTag: doc.authTag,
        ciphertext: doc.ciphertext
      },
      kdcTicketB: doc.kdcTicketB || null,
      timestamp: doc.timestamp
    };
  }

  const now = new Date().toISOString();
  const message = {
    id: String(directMessages.length + 1),
    conversationId: resolvedConversationId,
    senderUsername: senderUserId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    algorithm: encrypted.algorithm,
    keyVersion: encrypted.keyVersion,
    kdcTicketB: payload.kdcTicketB || null,
    timestamp: now
  };

  directMessages.push(message);
  conversation.lastMessageAt = now;

  return {
    id: message.id,
    conversationId: resolvedConversationId,
    senderUsername: message.senderUsername,
    senderUserId: message.senderUsername,
    senderDisplayName,
    encrypted: {
      algorithm: message.algorithm,
      iv: message.iv,
      authTag: message.authTag,
      ciphertext: message.ciphertext
    },
    kdcTicketB: message.kdcTicketB || null,
    timestamp: message.timestamp
  };
}

async function resetDataPreserveAdmin() {
  if (useDatabase) {
    const deletedMessages = await Message.deleteMany({});
    const deletedConversations = await Conversation.deleteMany({});
    const deletedUsers = await User.deleteMany({ role: { $ne: 'admin' } });
    return {
      deletedUsers: deletedUsers.deletedCount || 0,
      deletedMessages: deletedMessages.deletedCount || 0,
      deletedConversations: deletedConversations.deletedCount || 0
    };
  }

  const deletedMessages = directMessages.length;
  const deletedConversations = conversations.length;
  const allUsernames = Object.keys(users);
  let deletedUsers = 0;

  allUsernames.forEach((username) => {
    if (users[username].role !== 'admin') {
      delete users[username];
      deletedUsers += 1;
    }
  });

  directMessages.length = 0;
  conversations.length = 0;

  return { deletedUsers, deletedMessages, deletedConversations };
}

// ============================================================
// Input Validation Helpers
// ============================================================
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasDangerousKeys(value) {
  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousKeys(item));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.entries(value).some(([key, nested]) => {
    if (key.startsWith('$') || key.includes('.')) {
      return true;
    }
    return hasDangerousKeys(nested);
  });
}

function validateLoginPayload(body) {
  if (!isPlainObject(body)) {
    return { error: 'Invalid request body' };
  }

  if (hasDangerousKeys(body)) {
    return { error: 'Invalid request payload' };
  }

  const { username, password } = body;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return { error: 'Username and password must be strings' };
  }

  const normalizedUsername = username.trim().toLowerCase();

  if (!normalizedUsername || !password) {
    return { error: 'Username and password required' };
  }

  if (normalizedUsername.length > USERNAME_MAX_LENGTH) {
    return { error: `Username must be ${USERNAME_MAX_LENGTH} characters or less` };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return { error: `Password must be ${PASSWORD_MAX_LENGTH} characters or less` };
  }

  return { normalizedUsername, password };
}

function validateMessagePayload(body) {
  if (!isPlainObject(body)) {
    return { error: 'Invalid request body' };
  }

  if (hasDangerousKeys(body)) {
    return { error: 'Invalid request payload' };
  }

  const { encrypted, kdcTicketB } = body;

  let normalizedTicketB = null;
  if (isPlainObject(kdcTicketB)) {
    const ticketAlg = typeof kdcTicketB.alg === 'string' ? kdcTicketB.alg.trim() : 'AES-256-GCM';
    const ticketIv = typeof kdcTicketB.ivB64 === 'string' ? kdcTicketB.ivB64 : (typeof kdcTicketB.iv === 'string' ? kdcTicketB.iv : '');
    const ticketCiphertext = typeof kdcTicketB.ciphertextB64 === 'string'
      ? kdcTicketB.ciphertextB64
      : (typeof kdcTicketB.ciphertext === 'string' ? kdcTicketB.ciphertext : '');
    const ticketTag = typeof kdcTicketB.tagB64 === 'string'
      ? kdcTicketB.tagB64
      : (typeof kdcTicketB.authTag === 'string' ? kdcTicketB.authTag : (typeof kdcTicketB.tag === 'string' ? kdcTicketB.tag : ''));

    if (!ticketIv || !ticketCiphertext || !ticketTag) {
      return { error: 'kdcTicketB is missing required fields' };
    }

    if (ticketIv.length > 128 || ticketTag.length > 128 || ticketCiphertext.length > 8192 || ticketAlg.length > 64) {
      return { error: 'kdcTicketB exceeds allowed size' };
    }

    normalizedTicketB = {
      alg: ticketAlg,
      ivB64: ticketIv,
      ciphertextB64: ticketCiphertext,
      tagB64: ticketTag
    };
  }

  if (isPlainObject(encrypted)) {
    const { algorithm, iv, ciphertext, authTag } = encrypted;

    if (typeof iv !== 'string' || typeof ciphertext !== 'string' || typeof authTag !== 'string') {
      return { error: 'Encrypted message payload is missing required fields' };
    }

    if (iv.length > 128 || authTag.length > 128 || ciphertext.length > 8192) {
      return { error: 'Encrypted message payload exceeds allowed size' };
    }

    return {
      encrypted: {
        algorithm: typeof algorithm === 'string' && algorithm ? algorithm : ENCRYPTION_ALGORITHM,
        iv,
        ciphertext,
        authTag
      },
      kdcTicketB: normalizedTicketB
    };
  }

  return { error: 'Encrypted payload required' };
}

function validateConversationPayload(body) {
  if (!isPlainObject(body)) {
    return { error: 'Invalid request body' };
  }

  if (hasDangerousKeys(body)) {
    return { error: 'Invalid request payload' };
  }

  const { targetUserId } = body;

  if (typeof targetUserId !== 'string') {
    return { error: 'targetUserId must be a string' };
  }

  const normalizedTargetUserId = targetUserId.trim();
  if (!normalizedTargetUserId) {
    return { error: 'targetUserId required' };
  }

  if (normalizedTargetUserId.length > 128) {
    return { error: 'targetUserId must be 128 characters or less' };
  }

  return { normalizedTargetUserId };
}

function validateDisplayNamePayload(body) {
  if (!isPlainObject(body)) {
    return { error: 'Invalid request body' };
  }

  if (hasDangerousKeys(body)) {
    return { error: 'Invalid request payload' };
  }

  const { displayName } = body;
  if (typeof displayName !== 'string') {
    return { error: 'displayName must be a string' };
  }

  const trimmedDisplayName = displayName.trim();
  if (trimmedDisplayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return { error: `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or less` };
  }

  const normalizedDisplayName = normalizeDisplayName(displayName);
  if (!normalizedDisplayName) {
    return { error: 'Display name is required' };
  }

  return { normalizedDisplayName };
}

function validatePasswordStrength(password) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  const typesCount = [hasUppercase, hasLowercase, hasDigit, hasSymbol].filter(Boolean).length;

  if (typesCount < 3) {
    return { error: 'Password must contain at least 3 of: uppercase letters, lowercase letters, digits, symbols' };
  }

  return { valid: true };
}

function canAttemptLogin(username) {
  const now = Date.now();
  const attemptInfo = failedLoginAttempts.get(username);

  if (!attemptInfo) {
    return true;
  }

  if (now - attemptInfo.windowStartedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
    failedLoginAttempts.delete(username);
    return true;
  }

  return attemptInfo.count < MAX_FAILED_LOGIN_ATTEMPTS;
}

function recordFailedLogin(username) {
  const now = Date.now();
  const attemptInfo = failedLoginAttempts.get(username);

  if (!attemptInfo || now - attemptInfo.windowStartedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
    failedLoginAttempts.set(username, { count: 1, windowStartedAt: now });
    return;
  }

  attemptInfo.count += 1;
  failedLoginAttempts.set(username, attemptInfo);
}

function clearFailedLogins(username) {
  failedLoginAttempts.delete(username);
}

function canPostMessage(username) {
  const now = Date.now();
  const limitInfo = messageRateLimits.get(username);

  if (!limitInfo) {
    messageRateLimits.set(username, { count: 1, windowStartedAt: now });
    return true;
  }

  if (now - limitInfo.windowStartedAt >= MESSAGE_WINDOW_MS) {
    messageRateLimits.set(username, { count: 1, windowStartedAt: now });
    return true;
  }

  if (limitInfo.count >= MAX_MESSAGES_PER_WINDOW) {
    return false;
  }

  limitInfo.count += 1;
  messageRateLimits.set(username, limitInfo);
  return true;
}

// ============================================================
// Authentication Middleware
// ============================================================
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getUserById(req.session.userId);

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// ============================================================
// Routes
// ============================================================

// Proxy KDC requests through backend in development to avoid browser CORS issues.
app.post('/api/kdc/*', async (req, res) => {
  const target = buildKdcProxyTarget(req.params[0]);

  try {
    const upstreamHeaders = {
      'Content-Type': 'application/json'
    };

    // Preserve KDC session/challenge state when upstream relies on cookies.
    if (req.headers.cookie) {
      upstreamHeaders.cookie = req.headers.cookie;
    }

    if (req.headers.authorization) {
      upstreamHeaders.authorization = req.headers.authorization;
    }

    const upstream = await fetch(target, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(req.body || {})
    });

    const setCookies = getSetCookieHeaders(upstream.headers);
    if (setCookies.length > 0) {
      res.setHeader('set-cookie', setCookies);
    }

    const contentType = upstream.headers.get('content-type') || '';
    const payload = await upstream.text();

    if (contentType.includes('application/json')) {
      try {
        return res.status(upstream.status).json(JSON.parse(payload || '{}'));
      } catch (error) {
        return res.status(upstream.status).json({ error: 'Invalid JSON from KDC upstream' });
      }
    }

    return res.status(upstream.status).send(payload);
  } catch (error) {
    console.error('KDC proxy error:', error.message || error);
    return res.status(502).json({ error: 'Failed to reach KDC upstream' });
  }
});

// Proxy KDC key discovery endpoint for register-key encryption material.
app.get('/api/keys/public-key', async (req, res) => {
  const target = buildKdcProxyTarget('keys/public-key');

  try {
    const upstreamHeaders = {};

    if (req.headers.cookie) {
      upstreamHeaders.cookie = req.headers.cookie;
    }

    if (req.headers.authorization) {
      upstreamHeaders.authorization = req.headers.authorization;
    }

    const upstream = await fetch(target, {
      method: 'GET',
      headers: upstreamHeaders
    });

    const setCookies = getSetCookieHeaders(upstream.headers);
    if (setCookies.length > 0) {
      res.setHeader('set-cookie', setCookies);
    }

    const contentType = upstream.headers.get('content-type') || '';
    const payload = await upstream.text();

    if (contentType.includes('application/json')) {
      try {
        return res.status(upstream.status).json(JSON.parse(payload || '{}'));
      } catch (error) {
        return res.status(upstream.status).json({ error: 'Invalid JSON from KDC upstream' });
      }
    }

    return res.status(upstream.status).send(payload);
  } catch (error) {
    console.error('KDC key proxy error:', error.message || error);
    return res.status(502).json({ error: 'Failed to reach KDC upstream' });
  }
});

// POST /api/login - Login or register user
app.post('/api/login', async (req, res) => {
  const payload = validateLoginPayload(req.body);
  if (payload.error) {
    await recordAuditEvent({
      eventType: eventTypes.LOGIN_FAILURE,
      status: 'failure',
      reason: 'invalid_payload',
      metadata: {
        route: '/api/login'
      },
      ...getAuditLogRequestContext(req)
    });
    return res.status(400).json({ error: payload.error });
  }

  const { normalizedUsername, password } = payload;
  const loginIdHash = hashLoginIdentifier(normalizedUsername);

  await recordAuditEvent({
    eventType: eventTypes.LOGIN_ATTEMPT,
    status: 'attempt',
    metadata: {
      loginIdHash,
      route: '/api/login'
    },
    ...getAuditLogRequestContext(req)
  });

  if (!canAttemptLogin(loginIdHash)) {
    await recordAuditEvent({
      eventType: eventTypes.LOGIN_FAILURE,
      status: 'failure',
      reason: 'rate_limited',
      metadata: {
        loginIdHash,
        route: '/api/login'
      },
      ...getAuditLogRequestContext(req)
    });
    return res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
  }

  try {
    let user = await getUserByLoginIdentifier(normalizedUsername);
    let isNewUser = false;

    // User exists: validate password
    if (user) {
      const isValidPassword = await verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        recordFailedLogin(loginIdHash);
        await recordAuditEvent({
          eventType: eventTypes.LOGIN_FAILURE,
          status: 'failure',
          reason: 'invalid_credentials',
          metadata: {
            loginIdHash,
            route: '/api/login'
          },
          ...getAuditLogRequestContext(req)
        });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!String(user.displayAlias || '').trim()) {
        user.displayAlias = normalizeDisplayName(normalizedUsername, user.userId);
        if (useDatabase && typeof user.save === 'function') {
          await user.save();
        }
      }

      clearFailedLogins(loginIdHash);
    } else {
      // New user: validate password strength before hashing
      const strengthCheck = validatePasswordStrength(password);
      if (strengthCheck.error) {
        await recordAuditEvent({
          eventType: eventTypes.LOGIN_FAILURE,
          status: 'failure',
          reason: 'weak_password',
          metadata: {
            loginIdHash,
            route: '/api/login'
          },
          ...getAuditLogRequestContext(req)
        });
        return res.status(400).json({ error: strengthCheck.error });
      }
      const passwordHash = await hashPassword(password);
      user = await createUser(normalizedUsername, passwordHash);
      await recordAuditEvent({
        eventType: eventTypes.USER_REGISTRATION,
        userId: user.userId,
        status: 'success',
        metadata: {
          loginIdHash,
          route: '/api/login'
        },
        ...getAuditLogRequestContext(req)
      });
      isNewUser = true;
    }

    // Create session
    req.session.userId = user.userId;
    req.session.role = user.role;
    req.session.displayAlias = user.displayAlias || '';

    // Explicitly save the session before responding
    req.session.save((err) => {
      if (err) {
        console.error('Session save error during login:', err);
        return res.status(500).json({ error: 'Session save failed' });
      }

      void recordAuditEvent({
        eventType: eventTypes.LOGIN_SUCCESS,
        userId: user.userId,
        status: 'success',
        metadata: {
          loginIdHash,
          route: '/api/login'
        },
        ...getAuditLogRequestContext(req)
      }).catch((error) => console.warn('Audit log write failed:', error));

      res.json({
        success: true,
        username: user.userId,
        userId: user.userId,
        displayName: normalizeDisplayName(user.displayAlias, user.userId),
        displayAlias: user.displayAlias || '',
        isAdmin: user.role === 'admin',
        isNewUser
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/login/kdc - Session bootstrap after KDC challenge/verify auth
app.post('/api/login/kdc', async (req, res) => {
  const body = req.body || {};

  if (!isPlainObject(body) || hasDangerousKeys(body)) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  const {
    protocolVersion,
    token,
    displayName,
    displayAlias,
    isNewUser,
    ts5,
    n3,
    proof
  } = body;
  const suppliedToken = typeof token === 'string' ? token.trim() : '';

  if (!suppliedToken) {
    await recordAuditEvent({
      eventType: eventTypes.KDC_LOGIN_FAILURE,
      status: 'failure',
      reason: 'missing_token',
      metadata: {
        route: '/api/login/kdc'
      },
      ...getAuditLogRequestContext(req)
    });
    return res.status(400).json({ error: 'token is required' });
  }

  await recordAuditEvent({
    eventType: eventTypes.KDC_LOGIN_ATTEMPT,
    status: 'attempt',
    metadata: {
      route: '/api/login/kdc'
    },
    ...getAuditLogRequestContext(req)
  });

  try {
    const tokenClaims = verifyKdcJwtToken(suppliedToken);
    const tokenUserId = String(tokenClaims.sub || '').trim();

    if (!tokenUserId) {
      await recordAuditEvent({
        eventType: eventTypes.KDC_LOGIN_FAILURE,
        status: 'failure',
        reason: 'invalid_token_subject',
        metadata: {
          route: '/api/login/kdc'
        },
        ...getAuditLogRequestContext(req)
      });
      return res.status(401).json({ error: 'Invalid KDC token subject' });
    }

    const protocolV2 = String(protocolVersion || '').trim().toLowerCase() === 'kdc-auth-v2';
    if (!protocolV2) {
      return res.status(400).json({
        error: 'protocolVersion must be kdc-auth-v2'
      });
    }

    if (typeof ts5 !== 'number' || !Number.isFinite(ts5)) {
      return res.status(400).json({ error: 'ts5 is required for kdc-auth-v2' });
    }

    if (typeof n3 !== 'string' || !n3.trim()) {
      return res.status(400).json({ error: 'n3 is required for kdc-auth-v2' });
    }

    if (typeof proof !== 'string' || !proof.trim()) {
      return res.status(400).json({ error: 'proof is required for kdc-auth-v2' });
    }

    const kdcVerification = await verifyKdcBootstrapProof({
      token: suppliedToken,
      ts5,
      n3: n3.trim(),
      proof: proof.trim()
    });

    const verifiedUserId = String(kdcVerification.userId || '').trim();
    if (verifiedUserId && verifiedUserId !== tokenUserId) {
      await recordAuditEvent({
        eventType: eventTypes.KDC_LOGIN_FAILURE,
        userId: tokenUserId,
        status: 'failure',
        reason: 'identity_mismatch',
        metadata: {
          route: '/api/login/kdc'
        },
        ...getAuditLogRequestContext(req)
      });
      return res.status(401).json({ error: 'KDC bootstrap identity mismatch' });
    }

    const user = await upsertUserFromKdcIdentity({
      userId: tokenUserId,
      loginId: tokenUserId,
      displayAlias: normalizeDisplayName(
        typeof displayName === 'string' ? displayName : '',
        typeof displayAlias === 'string' ? displayAlias : ''
      )
    });

    req.session.userId = user.userId;
    req.session.role = user.role;
    req.session.displayAlias = user.displayAlias || '';

    // Explicitly save the session before responding to ensure it persists
    req.session.save((err) => {
      if (err) {
        console.error('Session save error during KDC login:', err);
        return res.status(500).json({ error: 'Session save failed' });
      }

      void recordAuditEvent({
        eventType: eventTypes.KDC_LOGIN_SUCCESS,
        userId: user.userId,
        status: 'success',
        metadata: {
          route: '/api/login/kdc'
        },
        ...getAuditLogRequestContext(req)
      }).catch((error) => console.warn('Audit log write failed:', error));

      return res.json({
        success: true,
        username: user.userId,
        userId: user.userId,
        displayName: normalizeDisplayName(user.displayAlias, user.userId),
        displayAlias: user.displayAlias || '',
        isAdmin: user.role === 'admin',
        isNewUser: Boolean(isNewUser),
        bootstrapProtocol: 'kdc-auth-v2'
      });
    });
  } catch (error) {
    await recordAuditEvent({
      eventType: eventTypes.KDC_LOGIN_FAILURE,
      status: 'failure',
      reason: error.message || 'verification_failed',
      metadata: {
        route: '/api/login/kdc'
      },
      ...getAuditLogRequestContext(req)
    });
    console.error('KDC login bridge error:', error.message || error);
    return res.status(401).json({ error: error.message || 'KDC token verification failed' });
  }
});

// POST /api/logout - Destroy session
app.post('/api/logout', (req, res) => {
  const currentUserId = req.session.userId;
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }

    void recordAuditEvent({
      eventType: eventTypes.LOGOUT,
      userId: currentUserId || null,
      status: 'success',
      metadata: {
        route: '/api/logout'
      },
      ...getAuditLogRequestContext(req)
    }).catch((error) => console.warn('Audit log write failed:', error));

    res.json({ success: true });
  });
});

// GET /api/session - Check if user is logged in
app.get('/api/session', (req, res) => {
  if (req.session.userId) {
    res.json({
      loggedIn: true,
      username: req.session.userId,
      userId: req.session.userId,
      displayName: normalizeDisplayName(req.session.displayAlias, req.session.userId),
      displayAlias: req.session.displayAlias || '',
      isAdmin: req.session.role === 'admin'
    });
  } else {
    res.json({ loggedIn: false });
  }
});

// GET /api/users - Get all available users (requires auth)
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const usersSummary = await getAllUsersSummary();
    const currentUserId = req.session.userId;
    const filtered = usersSummary
      .filter((user) => user.userId !== currentUserId)
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.userId.localeCompare(b.userId));
    res.json(filtered);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/conversations - Get direct-message conversations for current user
app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    const conversationsList = await getConversationsForUser(req.session.userId);
    res.json(conversationsList);
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/conversations - Create or get direct-message conversation
app.post('/api/conversations', requireAuth, async (req, res) => {
  const payload = validateConversationPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  const currentUserId = req.session.userId;
  const targetUserId = payload.normalizedTargetUserId;

  if (targetUserId === currentUserId) {
    return res.status(400).json({ error: 'Cannot start a conversation with yourself' });
  }

  try {
    const targetUser = await getUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const conversation = await findOrCreateConversation(currentUserId, targetUserId);
    return res.status(201).json(toConversationResponse(conversation, currentUserId));
  } catch (err) {
    console.error('Create conversation error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/conversations/:conversationId/messages - Get messages for one conversation
app.get('/api/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  try {
    const messagesForConversation = await getMessagesForConversation(
      req.params.conversationId,
      req.session.userId
    );

    if (!messagesForConversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.json(messagesForConversation);
  } catch (err) {
    console.error('Get conversation messages error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/profile/display-name - Change current user's display name
app.patch('/api/profile/display-name', requireAuth, async (req, res) => {
  const payload = validateDisplayNamePayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  const currentUserId = req.session.userId;
  const requestedDisplayName = payload.normalizedDisplayName;

  try {
    const duplicateExists = await isDisplayNameTaken(requestedDisplayName, currentUserId);
    if (duplicateExists) {
      return res.status(409).json({ error: 'Display name is already in use' });
    }

    const user = await getUserById(currentUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.displayAlias = requestedDisplayName;
    if (useDatabase && typeof user.save === 'function') {
      await user.save();
    }

    req.session.displayAlias = requestedDisplayName;

    return req.session.save((err) => {
      if (err) {
        console.error('Session save error during display-name update:', err);
        return res.status(500).json({ error: 'Session save failed' });
      }

      void recordAuditEvent({
        eventType: eventTypes.DISPLAY_NAME_CHANGE,
        userId: currentUserId,
        status: 'success',
        metadata: {
          route: '/api/profile/display-name',
          newDisplayName: requestedDisplayName
        },
        ...getAuditLogRequestContext(req)
      }).catch((error) => console.warn('Audit log write failed:', error));

      return res.json({
        success: true,
        userId: currentUserId,
        displayName: requestedDisplayName
      });
    });
  } catch (err) {
    console.error('Update display name error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/conversations/:conversationId/messages - Send a direct message
app.post('/api/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  const payload = validateMessagePayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  if (!canPostMessage(req.session.userId)) {
    await recordAuditEvent({
      eventType: eventTypes.MESSAGE_RATE_LIMITED,
      userId: req.session.userId,
      status: 'failure',
      reason: 'rate_limited',
      metadata: {
        route: '/api/conversations/:conversationId/messages',
        conversationId: req.params.conversationId
      },
      ...getAuditLogRequestContext(req)
    });
    return res.status(429).json({ error: 'Too many messages sent. Please wait before sending more.' });
  }

  try {
    const message = await createConversationMessage(
      req.params.conversationId,
      req.session.userId,
      payload
    );

    if (!message) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.status(201).json(message);
  } catch (err) {
    console.error('Create conversation message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/reset - Clear non-admin users and all messages (testing only)
app.post('/api/admin/reset', requireAuth, requireAdmin, async (req, res) => {
  await recordAuditEvent({
    eventType: eventTypes.ADMIN_RESET_ATTEMPT,
    userId: req.session.userId,
    status: 'attempt',
    metadata: {
      route: '/api/admin/reset'
    },
    ...getAuditLogRequestContext(req)
  });

  if (!ALLOW_RESET) {
    await recordAuditEvent({
      eventType: eventTypes.ADMIN_RESET_FAILURE,
      userId: req.session.userId,
      status: 'failure',
      reason: 'disabled',
      metadata: {
        route: '/api/admin/reset'
      },
      ...getAuditLogRequestContext(req)
    });
    return res.status(403).json({
      error: 'Reset endpoint is disabled. Set ALLOW_RESET=true for testing.'
    });
  }

  try {
    const result = await resetDataPreserveAdmin();
    await recordAuditEvent({
      eventType: eventTypes.ADMIN_RESET_SUCCESS,
      userId: req.session.userId,
      status: 'success',
      metadata: {
        route: '/api/admin/reset',
        deletedUsers: result.deletedUsers,
        deletedMessages: result.deletedMessages,
        deletedConversations: result.deletedConversations
      },
      ...getAuditLogRequestContext(req)
    });
    return res.json({
      success: true,
      message: 'Reset complete. Admin accounts were preserved.',
      ...result
    });
  } catch (err) {
    await recordAuditEvent({
      eventType: eventTypes.ADMIN_RESET_FAILURE,
      userId: req.session.userId,
      status: 'failure',
      reason: 'server_error',
      metadata: {
        route: '/api/admin/reset'
      },
      ...getAuditLogRequestContext(req)
    });
    console.error('Admin reset error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/profile/activity-logs - View personal account activity
app.get('/api/profile/activity-logs', requireAuth, async (req, res) => {
  try {
    const logs = await getAuditLogs({ userId: req.session.userId }, 50);
    res.json(logs);
  } catch (err) {
    console.error('Fetch activity logs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// Production: Serve static React build
// ============================================================
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../client/build')));

  // Catch-all: serve index.html for client-side routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Start server
initializeAppData().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
});
