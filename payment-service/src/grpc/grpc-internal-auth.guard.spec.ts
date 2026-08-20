import { ExecutionContext } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { AppConfig } from '../config/configuration';
import { GrpcInternalAuthGuard } from './grpc-internal-auth.guard';

function contextWithMetadata(metadata: Metadata): ExecutionContext {
  return {
    switchToRpc: () => ({ getContext: () => metadata }),
  } as unknown as ExecutionContext;
}

describe('GrpcInternalAuthGuard', () => {
  const cfg = { internalToken: 'payment-secret', internalService: 'backend' } as AppConfig;

  it('accepts the configured token and service scope', () => {
    const metadata = new Metadata();
    metadata.set('x-rial-internal-token', 'payment-secret');
    metadata.set('x-rial-service', 'backend');
    expect(new GrpcInternalAuthGuard(cfg as never).canActivate(contextWithMetadata(metadata))).toBe(true);
  });

  it.each([
    ['missing token', [['x-rial-service', 'backend']]],
    ['wrong token', [['x-rial-internal-token', 'wrong'], ['x-rial-service', 'backend']]],
    ['missing service', [['x-rial-internal-token', 'payment-secret']]],
    ['wrong service', [['x-rial-internal-token', 'payment-secret'], ['x-rial-service', 'launchpad']]],
  ])('rejects %s', (_name, entries) => {
    const metadata = new Metadata();
    for (const [key, value] of entries) metadata.set(key, value);
    try {
      new GrpcInternalAuthGuard(cfg as never).canActivate(contextWithMetadata(metadata));
      fail('expected RpcException');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toMatchObject({ code: GrpcStatus.UNAUTHENTICATED });
    }
  });
});
