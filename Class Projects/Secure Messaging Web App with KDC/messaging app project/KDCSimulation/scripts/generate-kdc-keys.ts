import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: {
    type: "spki",
    format: "pem"
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem"
  }
});

function toEscapedMultiline(value: string): string {
  return value.replace(/\n/g, "\\n");
}

console.log("# Raw PEM values (multiline)");
console.log("KDC_PUBLIC_KEY_PEM=");
console.log(publicKey);
console.log("KDC_PRIVATE_KEY_PEM=");
console.log(privateKey);

console.log("# Escaped .env format (single-line)");
console.log(`KDC_PUBLIC_KEY_PEM=\"${toEscapedMultiline(publicKey)}\"`);
console.log(`KDC_PRIVATE_KEY_PEM=\"${toEscapedMultiline(privateKey)}\"`);
