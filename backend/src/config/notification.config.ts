import { registerAs } from '@nestjs/config';

export interface NotificationConfig {
  smtp: {
    enabled: boolean;
    host?: string;
    port: number;
    user?: string;
    pass?: string;
    from: string;
    secure: boolean;
  };
  sms: {
    enabled: boolean;
    provider: string;
    apiKey?: string;
    from?: string;
  };
  push: {
    enabled: boolean;
    vapidPublicKey?: string;
    vapidPrivateKey?: string;
    subject?: string;
  };
  telegram: {
    enabled: boolean;
    botToken?: string;
  };
  discord: {
    enabled: boolean;
    webhookUrl?: string;
  };
  templates: {
    dir: string;
  };
}

export const notificationConfig = registerAs('notification', (): NotificationConfig => ({
  smtp: {
    enabled: process.env.SMTP_ENABLED === 'true',
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? 'noreply@rial.local',
    secure: process.env.SMTP_SECURE === 'true',
  },
  sms: {
    enabled: process.env.SMS_ENABLED === 'true',
    provider: process.env.SMS_PROVIDER ?? 'twilio',
    apiKey: process.env.SMS_API_KEY,
    from: process.env.SMS_FROM,
  },
  push: {
    enabled: process.env.PUSH_ENABLED === 'true',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@rial.local',
  },
  telegram: {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN,
  },
  discord: {
    enabled: process.env.DISCORD_ENABLED === 'true',
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
  templates: {
    dir: process.env.NOTIFY_TPL_DIR ?? './templates/notifications',
  },
}));
