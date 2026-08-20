import { registerAs } from '@nestjs/config';

export interface MatchingConfig {
  grpcUrl: string;
  serviceToken: string;
  enabled: boolean;
  maxOrderAmountMinor: bigint;
  minOrderAmountMinor: bigint;
}

export const matchingConfig = registerAs('matching', (): MatchingConfig => {
  const serviceToken = process.env.MATCHING_SERVICE_TOKEN ?? '';
  if (process.env.NODE_ENV === 'production' && (serviceToken.length < 32 || serviceToken === 'change-me')) {
    throw new Error('MATCHING_SERVICE_TOKEN must be a unique secret of at least 32 characters in production');
  }
  return {
  grpcUrl: process.env.MATCHING_GRPC_URL ?? 'matching-engine:9091',
  serviceToken,
  enabled: process.env.MATCHING_ENABLED !== 'false',
  maxOrderAmountMinor: BigInt(process.env.MATCHING_MAX_ORDER_AMOUNT_MINOR ?? '1000000000000'),
  minOrderAmountMinor: BigInt(process.env.MATCHING_MIN_ORDER_AMOUNT_MINOR ?? '1'),
  };
});
