import type { NextApiRequest } from "next";

type Bucket = {
  count: number;
  windowStartMs: number;
};

type Decision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(req: NextApiRequest, routeKey: string, maxRequests: number, windowMs: number): Decision {
  const ip = getClientIp(req);
  const now = Date.now();
  const key = `${routeKey}:${ip}`;
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.ceil((windowMs - (now - existing.windowStartMs)) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return { allowed: true, retryAfterSeconds: 0 };
}

function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

export function resetRateLimiterForTests(): void {
  buckets.clear();
}
