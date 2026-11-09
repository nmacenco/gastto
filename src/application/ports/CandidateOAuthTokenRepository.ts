export interface CandidateOAuthToken {
  requestId: string;
  userId: string;
  accessTokenEnc: Buffer;
  refreshTokenEnc: Buffer;
  iv: Buffer;
  refreshIv: Buffer;
  accessTokenExpiresAt: Date;
  scope: string[];
  grantedAt: Date;
  lastRefreshedAt: Date | null;
  revokedAt: Date | null;
}

export interface CandidateOAuthTokenRepository {
  upsert(token: CandidateOAuthToken): Promise<void>;
  findByRequestId(requestId: string): Promise<CandidateOAuthToken | null>;
  markRefreshed(
    requestId: string,
    accessTokenEnc: Buffer,
    iv: Buffer,
    expiresAt: Date,
  ): Promise<void>;
  markRevoked(requestId: string): Promise<void>;
  delete(requestId: string): Promise<void>;
}
