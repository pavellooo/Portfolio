import type { ApiErrorCode } from "@/lib/types";

export class ApiHttpError extends Error {
  public readonly status: number;

  public readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): never {
  throw new ApiHttpError(400, "bad_request", message);
}

export function unauthorized(message: string): never {
  throw new ApiHttpError(401, "unauthorized", message);
}

export function notFound(message: string): never {
  throw new ApiHttpError(404, "not_found", message);
}

export function conflict(message: string): never {
  throw new ApiHttpError(409, "conflict", message);
}

export function tooManyRequests(message: string): never {
  throw new ApiHttpError(429, "too_many_requests", message);
}

export function replay(message: string): never {
  throw new ApiHttpError(409, "replay", message);
}