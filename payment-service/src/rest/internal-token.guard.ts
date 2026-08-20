// Author: QalamHipHop
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { APP_CONFIG } from '../config/payment-config.module';
import { AppConfig } from '../config/configuration';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const raw = request.headers['x-internal-token'];
    const provided = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
    const rawService = request.headers['x-rial-service'];
    const service = Array.isArray(rawService) ? rawService[0] ?? '' : rawService ?? '';
    const expected = this.cfg.internalToken;
    const validToken = expected.length > 0 && provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    const validService = service === (this.cfg.internalService ?? 'backend');
    const valid = validToken && validService;
    if (!valid) throw new UnauthorizedException('internal_auth_required');
    return true;
  }
}
