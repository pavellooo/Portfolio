import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSigningPublicKeyPemSafe } from "@/lib/auth";
import { getAuthSigningKid } from "@/lib/config";
import { withApiGuards } from "@/lib/http";

type AuthPublicKeyResponse = {
  algorithm: "RS256";
  kid: string;
  publicKeyPem: string;
};

async function handler(_req: NextApiRequest, res: NextApiResponse<AuthPublicKeyResponse>): Promise<void> {
  res.status(200).json({
    algorithm: "RS256",
    kid: getAuthSigningKid(),
    publicKeyPem: getAuthSigningPublicKeyPemSafe()
  });
}

export default withApiGuards<AuthPublicKeyResponse>(["GET", "OPTIONS"], handler);