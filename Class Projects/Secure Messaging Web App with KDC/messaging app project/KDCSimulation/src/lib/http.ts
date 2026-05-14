import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { getAllowedOrigins, getProtocolVersion } from "@/lib/config";
import { ApiHttpError } from "@/lib/errors";
import type { ApiErrorBody, ApiErrorCode } from "@/lib/types";

type Handler<T = unknown> = (req: NextApiRequest, res: NextApiResponse<T>) => Promise<void> | void;

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(redactSensitive(value));
  } catch {
    return "[unserializable]";
  }
}

function redactSensitive(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  const sensitiveHints = [
    "password",
    "verifier",
    "proof",
    "token",
    "private",
    "sessionkeyplain",
    "encrypteduserkey",
    "kcs",
    "kconv",
    "challengeb64"
  ];
  const record = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    if (sensitiveHints.some((hint) => normalizedKey.includes(hint))) {
      redacted[key] = "[REDACTED]";
      continue;
    }

    redacted[key] = redactSensitive(fieldValue);
  }

  return redacted;
}

function logIncomingRequest(req: NextApiRequest, requestId: string): void {
  if (!isLocalDevelopment()) {
    return;
  }

  const headers = {
    origin: req.headers.origin,
    "x-forwarded-for": req.headers["x-forwarded-for"],
    "content-type": req.headers["content-type"],
    "x-request-id": req.headers["x-request-id"]
  };

  console.info(
    `[${requestId}] Request ${req.method ?? "UNKNOWN"} ${req.url ?? ""} headers=${safeJson(headers)} body=${safeJson(req.body)}`
  );
}

function attachResponseLogger(res: NextApiResponse, requestId: string): void {
  if (!isLocalDevelopment()) {
    return;
  }

  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  let statusCode = res.statusCode;

  res.status = ((code: number) => {
    statusCode = code;
    return originalStatus(code);
  }) as NextApiResponse["status"];

  res.json = ((body: unknown) => {
    console.info(`[${requestId}] Response ${statusCode} body=${safeJson(body)}`);
    return originalJson(body as never);
  }) as NextApiResponse["json"];
}

function getRequestId(req: NextApiRequest): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && incoming.trim()) {
    return incoming.trim();
  }
  return randomUUID();
}

function setCors(req: NextApiRequest, res: NextApiResponse): void {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;
  const requestedHeaders = req.headers["access-control-request-headers"];

  if (allowedOrigins.length === 0 || !origin) {
    return;
  }

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (typeof requestedHeaders === "string" && requestedHeaders.trim()) {
      // Mirror browser-requested headers for preflight checks (ex: authorization).
      res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
    } else {
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
}

function isOriginAllowed(req: NextApiRequest): boolean {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;

  if (!origin || allowedOrigins.length === 0) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

export function sendError(res: NextApiResponse, status: number, code: ApiErrorCode, message: string): void {
  const body: ApiErrorBody = code ? { error: message, code } : { error: message };
  res.status(status).json(body);
}

export function withApiGuards<T = unknown>(
  methods: Array<"GET" | "POST" | "OPTIONS">,
  handler: Handler<T>,
  options?: {
    errorProtocolVersion?: string;
  }
): Handler<T | ApiErrorBody | { ok: true }> {
  return async (req, res) => {
    const requestId = getRequestId(req);
    attachResponseLogger(res, requestId);
    res.setHeader("X-Request-Id", requestId);
    logIncomingRequest(req, requestId);
    setCors(req, res);

    if (!isOriginAllowed(req)) {
      sendError(res, 400, "bad_request", "Origin not allowed");
      return;
    }

    if (req.method === "OPTIONS") {
      res.status(200).json({ ok: true });
      return;
    }

    if (!req.method || !methods.includes(req.method as "GET" | "POST" | "OPTIONS")) {
      sendError(res, 405, "bad_request", "Unsupported HTTP method");
      return;
    }

    try {
      await handler(req, res as NextApiResponse<T>);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        sendError(res, error.status, error.code, error.message);
        return;
      }

      const message = error instanceof Error ? error.message : "Internal server error";
      console.error(`[${requestId}] API error: ${message}`);
      sendError(res, 500, "internal", "Internal server error");
    }
  };
}
