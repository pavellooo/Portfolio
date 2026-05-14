import type { NextApiRequest, NextApiResponse } from "next";
import { getProtocolVersion } from "@/lib/config";
import { getPublicKeyPem } from "@/lib/crypto";
import { withApiGuards } from "@/lib/http";
import { KDC_KEY_ALG } from "@/lib/types";

type PublicKeyResponse = {
  protocolVersion: string;
  kdcKeyAlg: typeof KDC_KEY_ALG;
  publicKeyPem: string;
};

async function handler(_req: NextApiRequest, res: NextApiResponse<PublicKeyResponse>): Promise<void> {
  res.status(200).json({
    protocolVersion: getProtocolVersion(),
    kdcKeyAlg: KDC_KEY_ALG,
    publicKeyPem: getPublicKeyPem()
  });
}

export default withApiGuards<PublicKeyResponse>(["GET", "OPTIONS"], handler);
