import { registerAs } from '@nestjs/config';

export interface LaunchpadConfig {
  defaultCurve: 'linear' | 'exponential' | 'logarithmic' | 'sigmoid';
  virtualRialReserveMinor: bigint;
  realRialReserveMinor: bigint;
  graduationRialMinor: bigint;
  maxTokensPerCreator: number;
  creatorFeeBps: number;
  platformFeeBps: number;
  minCreatorStakeMinor: bigint;
  enableModeration: boolean;
  riskAiEnabled: boolean;
  aiServiceUrl: string;
}

export const launchpadConfig = registerAs('launchpad', (): LaunchpadConfig => ({
  defaultCurve: (process.env.LAUNCHPAD_CURVE as LaunchpadConfig['defaultCurve']) ?? 'sigmoid',
  virtualRialReserveMinor: BigInt(process.env.LAUNCHPAD_VIRTUAL_RIAL_MINOR ?? '30000000000'),
  realRialReserveMinor: BigInt(process.env.LAUNCHPAD_REAL_RIAL_MINOR ?? '0'),
  graduationRialMinor: BigInt(process.env.LAUNCHPAD_GRADUATION_RIAL_MINOR ?? '69000000000'),
  maxTokensPerCreator: Number(process.env.LAUNCHPAD_MAX_TOKENS_PER_CREATOR ?? 5),
  creatorFeeBps: Number(process.env.LAUNCHPAD_CREATOR_FEE_BPS ?? 100),
  platformFeeBps: Number(process.env.LAUNCHPAD_PLATFORM_FEE_BPS ?? 100),
  minCreatorStakeMinor: BigInt(process.env.LAUNCHPAD_MIN_CREATOR_STAKE_MINOR ?? '100000000'),
  enableModeration: process.env.LAUNCHPAD_MODERATION !== 'false',
  riskAiEnabled: process.env.LAUNCHPAD_RISK_AI !== 'false',
  aiServiceUrl: process.env.AI_ENGINE_URL ?? 'http://ai-engine:8088',
}));
