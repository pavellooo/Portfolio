import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getAuthChallengeTtlSeconds, getAuthTokenTtlSeconds } from "@/lib/config";
import type { AuthChallengeRecord, SessionRecord, UserAuthRecord, UserKeyRecord } from "@/lib/types";

export interface KdcStorage {
  getUserByIdc(idc: string): Promise<UserAuthRecord | null>;
  getUserByUserId(userId: string): Promise<UserAuthRecord | null>;
  upsertUserByIdc(input: {
    idc: string;
    userId: string;
    displayAlias: string;
    saltB64: string;
    iterations: number;
    verifierB64: string;
  }): Promise<UserAuthRecord>;
  updateUserVerifierB64(idc: string, verifierB64: string): Promise<UserAuthRecord | null>;
  createAuthChallenge(input: {
    challengeId: string;
    idc: string;
    challengeB64: string;
    n1: string;
    ts2: number;
    expiresAt: string;
  }): Promise<AuthChallengeRecord>;
  getAuthChallengeById(challengeId: string): Promise<AuthChallengeRecord | null>;
  markAuthChallengeUsed(challengeId: string): Promise<void>;
  createSession(input: { userId: string; tokenJti: string; kcsB64: string; createdAt: string; expiresAt: string }): Promise<SessionRecord>;
  getSessionByTokenJti(tokenJti: string): Promise<SessionRecord | null>;
  getLatestActiveSessionByUserId(userId: string, nowIso?: string): Promise<SessionRecord | null>;
  markBootstrapNonceUsed(input: { userId: string; tokenJti: string; n3: string; expiresAt: string }): Promise<boolean>;
  upsertUserKey(input: { userId: string; userKeyB64: string }): Promise<UserKeyRecord>;
  getUserKeyByUserId(userId: string): Promise<UserKeyRecord | null>;
}

class InMemoryKdcStorage implements KdcStorage {
  private readonly usersByIdc = new Map<string, UserAuthRecord>();

  private readonly usersByUserId = new Map<string, UserAuthRecord>();

  private readonly challengesById = new Map<string, AuthChallengeRecord>();

  private readonly sessionsByTokenJti = new Map<string, SessionRecord>();

  private readonly sessionJtisByUserId = new Map<string, string[]>();

  private readonly bootstrapReplayKeys = new Set<string>();

  private readonly userKeys = new Map<string, UserKeyRecord>();

  private storeUser(record: UserAuthRecord): UserAuthRecord {
    this.usersByIdc.set(record.idc, record);
    this.usersByUserId.set(record.userId, record);
    return record;
  }

  async getUserByIdc(idc: string): Promise<UserAuthRecord | null> {
    return this.usersByIdc.get(idc) ?? null;
  }

  async getUserByUserId(userId: string): Promise<UserAuthRecord | null> {
    return this.usersByUserId.get(userId) ?? null;
  }

  async upsertUserByIdc(input: {
    idc: string;
    userId: string;
    displayAlias: string;
    saltB64: string;
    iterations: number;
    verifierB64: string;
  }): Promise<UserAuthRecord> {
    const now = new Date().toISOString();
    const existing = this.usersByIdc.get(input.idc);
    const record: UserAuthRecord = {
      idc: input.idc,
      userId: existing?.userId ?? input.userId,
      displayAlias: existing?.displayAlias ?? input.displayAlias,
      saltB64: existing?.saltB64 ?? input.saltB64,
      iterations: existing?.iterations ?? input.iterations,
      verifierB64: existing?.verifierB64 ?? input.verifierB64,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    return this.storeUser(record);
  }

  async updateUserVerifierB64(idc: string, verifierB64: string): Promise<UserAuthRecord | null> {
    const existing = this.usersByIdc.get(idc);
    if (!existing) {
      return null;
    }

    const updated: UserAuthRecord = {
      ...existing,
      verifierB64,
      updatedAt: new Date().toISOString()
    };

    return this.storeUser(updated);
  }

  async createAuthChallenge(input: {
    challengeId: string;
    idc: string;
    challengeB64: string;
    n1: string;
    ts2: number;
    expiresAt: string;
  }): Promise<AuthChallengeRecord> {
    const record: AuthChallengeRecord = {
      challengeId: input.challengeId,
      idc: input.idc,
      challengeB64: input.challengeB64,
      n1: input.n1,
      ts2: input.ts2,
      used: false,
      expiresAt: input.expiresAt
    };

    this.challengesById.set(record.challengeId, record);
    return record;
  }

  async getAuthChallengeById(challengeId: string): Promise<AuthChallengeRecord | null> {
    return this.challengesById.get(challengeId) ?? null;
  }

  async markAuthChallengeUsed(challengeId: string): Promise<void> {
    const existing = this.challengesById.get(challengeId);
    if (!existing) {
      return;
    }

    this.challengesById.set(challengeId, {
      ...existing,
      used: true
    });
  }

  async createSession(input: { userId: string; tokenJti: string; kcsB64: string; createdAt: string; expiresAt: string }): Promise<SessionRecord> {
    const record: SessionRecord = {
      userId: input.userId,
      tokenJti: input.tokenJti,
      kcsB64: input.kcsB64,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt
    };

    this.sessionsByTokenJti.set(record.tokenJti, record);
    const userJtis = this.sessionJtisByUserId.get(record.userId) ?? [];
    userJtis.push(record.tokenJti);
    this.sessionJtisByUserId.set(record.userId, userJtis);
    return record;
  }

  async getSessionByTokenJti(tokenJti: string): Promise<SessionRecord | null> {
    return this.sessionsByTokenJti.get(tokenJti) ?? null;
  }

  async getLatestActiveSessionByUserId(userId: string, nowIso?: string): Promise<SessionRecord | null> {
    const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
    const userJtis = this.sessionJtisByUserId.get(userId) ?? [];

    for (let index = userJtis.length - 1; index >= 0; index -= 1) {
      const session = this.sessionsByTokenJti.get(userJtis[index]);
      if (!session) {
        continue;
      }

      if (Date.parse(session.expiresAt) > nowMs) {
        return session;
      }
    }

    return null;
  }

  async markBootstrapNonceUsed(input: { userId: string; tokenJti: string; n3: string; expiresAt: string }): Promise<boolean> {
    const key = `${input.userId}:${input.tokenJti}:${input.n3}`;
    if (this.bootstrapReplayKeys.has(key)) {
      return false;
    }

    this.bootstrapReplayKeys.add(key);
    return true;
  }

  async upsertUserKey(input: { userId: string; userKeyB64: string }): Promise<UserKeyRecord> {
    const now = new Date().toISOString();
    const existing = this.userKeys.get(input.userId);
    const record: UserKeyRecord = {
      userId: input.userId,
      userKeyB64: input.userKeyB64,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.userKeys.set(record.userId, record);
    return record;
  }

  async getUserKeyByUserId(userId: string): Promise<UserKeyRecord | null> {
    return this.userKeys.get(userId) ?? null;
  }
}

class RedisKdcStorage implements KdcStorage {
  private readonly redis: Redis;

  private readonly prefix: string;

  constructor() {
    const redisEnv = getRedisEnv();
    this.redis = new Redis({ url: redisEnv.url, token: redisEnv.token });
    this.prefix = process.env.KDC_STORAGE_PREFIX?.trim() || "kdc";
  }

  private keyUserByIdc(idc: string): string {
    return `${this.prefix}:user:idc:${idc}`;
  }

  private keyUserByUserId(userId: string): string {
    return `${this.prefix}:user:userId:${userId}`;
  }

  private keyChallenge(challengeId: string): string {
    return `${this.prefix}:auth:challenge:${challengeId}`;
  }

  private keySession(tokenJti: string): string {
    return `${this.prefix}:auth:session:${tokenJti}`;
  }

  private keyUserSessions(userId: string): string {
    return `${this.prefix}:auth:session:user:${userId}`;
  }

  private keyBootstrapReplay(userId: string, tokenJti: string, n3: string): string {
    return `${this.prefix}:auth:bootstrap-replay:${userId}:${tokenJti}:${n3}`;
  }

  private keyUserKey(userId: string): string {
    return `${this.prefix}:user-key:${userId}`;
  }

  private async setJson(key: string, value: unknown): Promise<void> {
    await this.redis.set(key, JSON.stringify(value));
  }

  private async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get<unknown>(key);
    if (raw === null || raw === undefined) {
      return null;
    }

    if (typeof raw === "string") {
      return JSON.parse(raw) as T;
    }

    if (typeof raw === "object") {
      return raw as T;
    }

    return null;
  }

  private async getStringArray(key: string): Promise<string[]> {
    const raw = await this.redis.get<unknown>(key);
    if (raw === null || raw === undefined) {
      return [];
    }

    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string");
    }

    if (typeof raw !== "string") {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  }

  async getUserByIdc(idc: string): Promise<UserAuthRecord | null> {
    return this.getJson<UserAuthRecord>(this.keyUserByIdc(idc));
  }

  async getUserByUserId(userId: string): Promise<UserAuthRecord | null> {
    return this.getJson<UserAuthRecord>(this.keyUserByUserId(userId));
  }

  async upsertUserByIdc(input: {
    idc: string;
    userId: string;
    displayAlias: string;
    saltB64: string;
    iterations: number;
    verifierB64: string;
  }): Promise<UserAuthRecord> {
    const existing = await this.getUserByIdc(input.idc);
    const now = new Date().toISOString();
    const record: UserAuthRecord = {
      idc: input.idc,
      userId: existing?.userId ?? input.userId,
      displayAlias: existing?.displayAlias ?? input.displayAlias,
      saltB64: existing?.saltB64 ?? input.saltB64,
      iterations: existing?.iterations ?? input.iterations,
      verifierB64: existing?.verifierB64 ?? input.verifierB64,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await this.setJson(this.keyUserByIdc(record.idc), record);
    await this.setJson(this.keyUserByUserId(record.userId), record);
    return record;
  }

  async updateUserVerifierB64(idc: string, verifierB64: string): Promise<UserAuthRecord | null> {
    const existing = await this.getUserByIdc(idc);
    if (!existing) {
      return null;
    }

    const updated: UserAuthRecord = {
      ...existing,
      verifierB64,
      updatedAt: new Date().toISOString()
    };

    await this.setJson(this.keyUserByIdc(idc), updated);
    await this.setJson(this.keyUserByUserId(updated.userId), updated);
    return updated;
  }

  async createAuthChallenge(input: {
    challengeId: string;
    idc: string;
    challengeB64: string;
    n1: string;
    ts2: number;
    expiresAt: string;
  }): Promise<AuthChallengeRecord> {
    const record: AuthChallengeRecord = {
      challengeId: input.challengeId,
      idc: input.idc,
      challengeB64: input.challengeB64,
      n1: input.n1,
      ts2: input.ts2,
      used: false,
      expiresAt: input.expiresAt
    };

    await this.setJson(this.keyChallenge(record.challengeId), record);
    const ttlSeconds = Math.max(1, Math.ceil((Date.parse(record.expiresAt) - Date.now()) / 1000));
    await this.redis.expire(this.keyChallenge(record.challengeId), ttlSeconds);
    return record;
  }

  async getAuthChallengeById(challengeId: string): Promise<AuthChallengeRecord | null> {
    return this.getJson<AuthChallengeRecord>(this.keyChallenge(challengeId));
  }

  async markAuthChallengeUsed(challengeId: string): Promise<void> {
    const existing = await this.getAuthChallengeById(challengeId);
    if (!existing) {
      return;
    }

    await this.setJson(this.keyChallenge(challengeId), { ...existing, used: true });
  }

  async createSession(input: { userId: string; tokenJti: string; kcsB64: string; createdAt: string; expiresAt: string }): Promise<SessionRecord> {
    const record: SessionRecord = {
      userId: input.userId,
      tokenJti: input.tokenJti,
      kcsB64: input.kcsB64,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt
    };

    await this.setJson(this.keySession(record.tokenJti), record);
    await this.redis.expire(this.keySession(record.tokenJti), Math.max(1, Math.ceil((Date.parse(record.expiresAt) - Date.now()) / 1000)));

    const userJtis = await this.getStringArray(this.keyUserSessions(record.userId));
    userJtis.push(record.tokenJti);
    await this.setJson(this.keyUserSessions(record.userId), userJtis);
    return record;
  }

  async getSessionByTokenJti(tokenJti: string): Promise<SessionRecord | null> {
    return this.getJson<SessionRecord>(this.keySession(tokenJti));
  }

  async getLatestActiveSessionByUserId(userId: string, nowIso?: string): Promise<SessionRecord | null> {
    const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
    const userJtis = await this.getStringArray(this.keyUserSessions(userId));

    for (let index = userJtis.length - 1; index >= 0; index -= 1) {
      const session = await this.getSessionByTokenJti(userJtis[index]);
      if (!session) {
        continue;
      }

      if (Date.parse(session.expiresAt) > nowMs) {
        return session;
      }
    }

    return null;
  }

  async markBootstrapNonceUsed(input: { userId: string; tokenJti: string; n3: string; expiresAt: string }): Promise<boolean> {
    const key = this.keyBootstrapReplay(input.userId, input.tokenJti, input.n3);
    const existing = await this.redis.get(key);
    if (existing !== null) {
      return false;
    }

    await this.redis.set(key, "1");
    await this.redis.expire(key, Math.max(1, Math.ceil((Date.parse(input.expiresAt) - Date.now()) / 1000)));
    return true;
  }

  async upsertUserKey(input: { userId: string; userKeyB64: string }): Promise<UserKeyRecord> {
    const existing = await this.getUserKeyByUserId(input.userId);
    const now = new Date().toISOString();
    const record: UserKeyRecord = {
      userId: input.userId,
      userKeyB64: input.userKeyB64,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await this.setJson(this.keyUserKey(record.userId), record);
    return record;
  }

  async getUserKeyByUserId(userId: string): Promise<UserKeyRecord | null> {
    return this.getJson<UserKeyRecord>(this.keyUserKey(userId));
  }
}

function getRedisEnv(): { url: string; token: string } {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim() || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim() || "";
  return { url, token };
}

function isRedisConfigured(): boolean {
  const redisEnv = getRedisEnv();
  return Boolean(redisEnv.url && redisEnv.token);
}

function shouldAllowInMemoryFallbackInProduction(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return process.env.KDC_ALLOW_IN_MEMORY_FALLBACK_IN_PRODUCTION?.trim().toLowerCase() === "true";
}

export function getStorageBackendName(): "redis" | "in-memory" {
  if (!storageSingleton) {
    return isRedisConfigured() ? "redis" : "in-memory";
  }

  return storageSingleton instanceof RedisKdcStorage ? "redis" : "in-memory";
}

let storageSingleton: KdcStorage | null = null;

export function getStorage(): KdcStorage {
  if (!storageSingleton) {
    if (!isRedisConfigured() && !shouldAllowInMemoryFallbackInProduction()) {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production to prevent key/session data loss"
      );
    }

    storageSingleton = isRedisConfigured() ? new RedisKdcStorage() : new InMemoryKdcStorage();
  }

  return storageSingleton;
}

export function resetStorageForTests(): void {
  storageSingleton = new InMemoryKdcStorage();
}
