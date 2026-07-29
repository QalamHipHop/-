import { NotificationsService } from './notifications.service';
import { AppConfig } from '../config/app.config';

describe('NotificationsService', () => {
  const cfg: AppConfig = {
    port: 50056,
    nodeEnv: 'test',
    logLevel: 'error',
  };

  it('returns skipped when no provider for channel', async () => {
    const svc = new NotificationsService(cfg);
    svc.onModuleInit();
    const res = await svc.send({
      id: 'x',
      channel: 'telegram',
      recipient: 'u',
      body: 'b',
    });
    expect(res.status).toBe('skipped');
  });

  it('sends via inbox', async () => {
    const svc = new NotificationsService(cfg);
    svc.onModuleInit();
    const res = await svc.send({
      id: 'y',
      channel: 'inbox',
      recipient: 'u',
      body: 'hello',
    });
    expect(res.status).toBe('sent');
  });

  it('is idempotent per (channel,id)', async () => {
    const svc = new NotificationsService(cfg);
    svc.onModuleInit();
    const n = { id: 'dup', channel: 'inbox' as const, recipient: 'u', body: 'b' };
    const a = await svc.send(n);
    const b = await svc.send(n);
    expect(a.status).toBe('sent');
    expect(b.status).toBe('skipped');
  });

  it('fanout to multiple channels', async () => {
    const svc = new NotificationsService(cfg);
    svc.onModuleInit();
    const out = await svc.fanout(
      { id: 'f', recipient: 'u', body: 'b' },
      ['inbox', 'email'],
    );
    expect(out.length).toBe(2);
    expect(out.every((r) => r.status === 'sent')).toBe(true);
  });
});
