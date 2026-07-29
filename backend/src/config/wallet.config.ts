import { registerAs } from '@nestjs/config';

export interface WalletConfig {
  grpcUrl: string;
  serviceToken: string;
  enabled: boolean;
}

export const walletConfig = registerAs('wallet', (): WalletConfig => ({
  grpcUrl: process.env.WALLET_GRPC_URL ?? 'wallet-service:9090',
  serviceToken: process.env.WALLET_SERVICE_TOKEN ?? 'change-me',
  enabled: process.env.WALLET_ENABLED !== 'false',
}));
