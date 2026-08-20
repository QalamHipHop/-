import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { timingSafeEqual } from 'node:crypto';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { APP_CONFIG } from '../config/payment-config.module';
import { AppConfig } from '../config/configuration';

@Injectable()
export class GrpcInternalAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = context.switchToRpc().getContext<Metadata>();
    const token = this.first(metadata, 'x-rial-internal-token');
    const service = this.first(metadata, 'x-rial-service');
    const expectedToken = this.cfg.internalToken;
    const expectedService = this.cfg.internalService ?? 'backend';
    const validToken = expectedToken.length > 0
      && token.length === expectedToken.length
      && timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
    if (!validToken || service !== expectedService) {
      throw new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'internal_auth_required' });
    }
    return true;
  }

  private first(metadata: Metadata | undefined, key: string): string {
    const value = metadata?.get(key)[0];
    return typeof value === 'string' ? value : value?.toString() ?? '';
  }
}
