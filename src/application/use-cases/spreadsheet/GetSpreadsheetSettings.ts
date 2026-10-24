import type {
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';

export interface SettingsSummary {
  credentialStatus: 'missing' | 'revoked' | 'available';
  provider: SpreadsheetProvider | null;
  fileName: string | null;
  sheetName: string | null;
}

export class GetSpreadsheetSettings {
  constructor(
    private readonly tokenRepository: IOAuthTokenRepository,
    private readonly configRepository: ISpreadsheetConfigRepository,
  ) {}

  async execute({ userId }: { userId: string }): Promise<SettingsSummary> {
    const config = await this.configRepository.findByUserId(userId);
    const provider = config?.provider ?? 'google';
    const primaryToken = await this.tokenRepository.findByUserAndProvider(userId, provider);
    const microsoftToken =
      !config && !primaryToken
        ? await this.tokenRepository.findByUserAndProvider(userId, 'microsoft')
        : null;
    const token = primaryToken ?? microsoftToken;
    return {
      credentialStatus: !token ? 'missing' : token.revokedAt ? 'revoked' : 'available',
      provider: config?.provider ?? (primaryToken ? provider : microsoftToken ? 'microsoft' : null),
      fileName: config?.fileName || null,
      sheetName: config?.sheetName || null,
    };
  }
}
