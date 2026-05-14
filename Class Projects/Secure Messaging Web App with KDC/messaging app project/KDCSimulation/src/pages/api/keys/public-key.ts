import type { NextApiRequest, NextApiResponse } from "next";
import { getProtocolVersion } from "@/lib/config";
import { getKdcEncryptionPublicKeyMetadata } from "@/lib/kdc-encryption-key";
import { withApiGuards } from "@/lib/http";

type KdcEncryptionPublicKeyResponse = {
  success: true;
  protocolVersion: string;
  algorithm: "RSA-OAEP-256";
  use: "enc";
  kid: string;
  publicKeyPem: string;
};

async function handler(_req: NextApiRequest, res: NextApiResponse<KdcEncryptionPublicKeyResponse>): Promise<void> {
  const key = await getKdcEncryptionPublicKeyMetadata();

  res.status(200).json({
    success: true,
    protocolVersion: getProtocolVersion(),
    algorithm: key.algorithm,
    use: key.use,
    kid: key.kid,
    publicKeyPem: key.publicKeyPem
  });
}

export default withApiGuards<KdcEncryptionPublicKeyResponse>(["GET", "OPTIONS"], handler);