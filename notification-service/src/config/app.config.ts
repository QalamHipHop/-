export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  redisUrl?: string;
  natsUrl?: string;
  kafkaBrokers?: string;
  smtp?: SmtpConfig;
  smsProvider?: SmsConfig;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  webPush?: WebPushConfig;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export interface SmsConfig {
  provider: 'kavenegar' | 'twilio' | 'noop';
  apiKey?: string;
  from?: string;
}

export interface TelegramConfig {
  botToken: string;
  defaultChatId?: string;
}

export interface DiscordConfig {
  webhookUrl: string;
}

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function loadConfig(): AppConfig {
  const env = process.env.NODE_ENV ?? 'development';
  const smsProviderName = process.env.SMS_PROVIDER;
  const smsProvider: SmsConfig | undefined =
    smsProviderName === 'kavenegar' || smsProviderName === 'twilio' || smsProviderName === 'noop'
      ? {
          provider: smsProviderName,
          apiKey: process.env.SMS_API_KEY,
          from: process.env.SMS_FROM,
        }
      : undefined;
  const telegramBot = envVar('TELEGRAM_BOT_TOKEN');
  const discordHook = envVar('DISCORD_WEBHOOK_URL');
  const webPushPub = envVar('WEBPUSH_PUBLIC_KEY');
  return {
    port: Number(process.env.PORT ?? 50056),
    nodeEnv: env,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    redisUrl: process.env.REDIS_URL,
    natsUrl: process.env.NATS_URL,
    kafkaBrokers: process.env.KAFKA_BROKERS,
    smtp: envVar('SMTP_HOST')
      ? {
          host: envVar('SMTP_HOST')!,
          port: Number(envVar('SMTP_PORT', '587') ?? '587'),
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
          from: envVar('SMTP_FROM', 'no-reply@rial.local')!,
        }
      : undefined,
    smsProvider,
    telegram: telegramBot ? { botToken: telegramBot } : undefined,
    discord: discordHook ? { webhookUrl: discordHook } : undefined,
    webPush: webPushPub
      ? {
          publicKey: webPushPub,
          privateKey: envVar('WEBPUSH_PRIVATE_KEY') ?? '',
          subject: envVar('WEBPUSH_SUBJECT', 'mailto:admin@rial.local')!,
        }
      : undefined,
  };
}

function envVar(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v;
}
