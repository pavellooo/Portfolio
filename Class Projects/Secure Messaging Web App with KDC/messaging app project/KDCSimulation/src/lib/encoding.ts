const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isBase64(value: string): boolean {
  if (!value || typeof value !== "string") {
    return false;
  }
  return BASE64_REGEX.test(value);
}

export function decodeBase64Strict(value: string, fieldName: string): Buffer {
  if (!isBase64(value)) {
    throw new Error(`${fieldName} must be valid base64`);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`${fieldName} must be canonical base64`);
  }

  return decoded;
}

export function decodeBase64ExactLength(value: string, expectedLength: number, fieldName: string): Buffer {
  const decoded = decodeBase64Strict(value, fieldName);
  if (decoded.length !== expectedLength) {
    throw new Error(`${fieldName} must decode to ${expectedLength} bytes`);
  }
  return decoded;
}

export function toBase64(data: Buffer): string {
  return data.toString("base64");
}
