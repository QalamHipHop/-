import { ExecutionContext } from '@nestjs/common';
import { InternalTokenGuard } from './internal-token.guard';
import { AppConfig } from '../config/configuration';

function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('InternalTokenGuard', () => {
  const cfg = { internalToken: 'payment-secret', internalService: 'backend' } as AppConfig;

  it('accepts only the configured token and service scope', () => {
    const guard = new InternalTokenGuard(cfg as never);
    expect(guard.canActivate(contextWithHeaders({ 'x-internal-token': 'payment-secret', 'x-rial-service': 'backend' }))).toBe(true);
  });

  it.each([
    ['missing token', { 'x-rial-service': 'backend' }],
    ['wrong token', { 'x-internal-token': 'wrong', 'x-rial-service': 'backend' }],
    ['missing service', { 'x-internal-token': 'payment-secret' }],
    ['wrong service', { 'x-internal-token': 'payment-secret', 'x-rial-service': 'launchpad' }],
  ])('rejects %s', (_name, headers) => {
    const guard = new InternalTokenGuard(cfg as never);
    expect(() => guard.canActivate(contextWithHeaders(headers))).toThrow('internal_auth_required');
  });
});
