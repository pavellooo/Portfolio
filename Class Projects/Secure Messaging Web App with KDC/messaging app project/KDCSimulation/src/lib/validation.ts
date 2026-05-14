import { badRequest } from "@/lib/errors";
import { decodeBase64Strict } from "@/lib/encoding";
import { AES_ENVELOPE_ALGORITHM, type AesGcmEnvelope } from "@/lib/types";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertProtocolVersion(protocolVersion: unknown, expected: string): void {
  if (protocolVersion !== expected) {
    badRequest(`Unsupported protocolVersion. Expected ${expected}`);
  }
}

export function assertObjectWithExactKeys(value: unknown, requiredKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("Request body must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const missing = requiredKeys.filter((key) => !(key in record));
  if (missing.length > 0) {
    badRequest(`Missing required fields: ${missing.join(", ")}`);
  }

  const extras = actualKeys.filter((key) => !requiredKeys.includes(key));
  if (extras.length > 0) {
    badRequest(`Unexpected fields: ${extras.join(", ")}`);
  }

  return record;
}

export function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    badRequest(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

export function assertBase64(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    badRequest(`${fieldName} must be a string`);
  }

  try {
    decodeBase64Strict(value, fieldName);
  } catch (error) {
    badRequest(error instanceof Error ? error.message : `${fieldName} must be valid base64`);
  }

  return value;
}

export function assertIsoTimestamp(value: unknown, fieldName: string): string {
  const timestamp = assertNonEmptyString(value, fieldName);
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    badRequest(`${fieldName} must be a valid ISO-8601 timestamp`);
  }
  return timestamp;
}

export function assertUuidV4(value: unknown, fieldName: string): string {
  const uuid = assertNonEmptyString(value, fieldName);
  if (!UUID_V4_REGEX.test(uuid)) {
    badRequest(`${fieldName} must be a UUID v4 string`);
  }
  return uuid;
}

export function assertPositiveInteger(value: unknown, fieldName: string): number {
  if (value === undefined || value === null) {
    badRequest(`${fieldName} is required`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    badRequest(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

export function assertEnvelope(value: unknown): AesGcmEnvelope {
  if (!value || typeof value !== "object") {
    badRequest("Envelope must be an object");
  }

  const envelope = value as Partial<AesGcmEnvelope>;
  if (envelope.alg !== AES_ENVELOPE_ALGORITHM) {
    badRequest(`Unsupported envelope alg. Expected ${AES_ENVELOPE_ALGORITHM}`);
  }

  assertBase64(envelope.ivB64, "ivB64");
  assertBase64(envelope.ciphertextB64, "ciphertextB64");
  assertBase64(envelope.tagB64, "tagB64");

  return envelope as AesGcmEnvelope;
}
