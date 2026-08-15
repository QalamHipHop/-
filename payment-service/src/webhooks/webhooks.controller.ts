// =============================================================================
//  Webhooks — receives provider callbacks and reconciles intent status
//  Author: Qalamhiphop
// =============================================================================
import { BadRequestException, Body, Controller, Headers, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { IntentsService } from '../intents/intents.service';
import { IntentJSON, IntentStatus, intentToJSON } from '../intents/intent.entity';
import { PaymentError } from '../adapters/types';

interface WebhookBody {
  rawBody?: Buffer;
  signature?: string;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly intents: IntentsService,
  ) {}

  @Post(':adapter')
  @HttpCode(200)
  async handle(
    @Param('adapter') adapter: string,
    @Req() req: Request,
    @Body() _body: WebhookBody,
    @Headers() headers: Record<string, string>,
  ): Promise<{ ok: true; intent: IntentJSON | null }> {
    if (!this.registry.get(adapter)) {
      throw new BadRequestException('unknown adapter: ' + adapter);
    }
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(_body ?? {}));
    const signature =
      headers['stripe-signature'] ??
      headers['x-nowpayments-signature'] ??
      headers['x-signature'] ??
      headers['signature'] ??
      '';

    const a = this.registry.get(adapter);
    try {
      const verify = await a.parseWebhook(raw, headers, signature);
      const existing = await this.intents.findByExternalId(adapter, verify.externalId);
      if (!existing) {
        // No intent — accept and ignore (provider may send test events).
        return { ok: true, intent: null };
      }
      const status = this.mapStatus(verify.status);
      const updated = await this.intents.applyVerifyResult(
        existing.id,
        status,
        verify.settledAmount,
        verify.failureReason,
      );
      return { ok: true, intent: updated };
    } catch (e) {
      if (e instanceof PaymentError) {
        throw new UnauthorizedException(e.message);
      }
      throw e;
    }
  }

  private mapStatus(s: string): IntentStatus {
    switch (s) {
      case 'succeeded':
        return 'succeeded';
      case 'processing':
        return 'processing';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'cancelled';
      case 'refunded':
        return 'refunded';
      case 'expired':
        return 'expired';
      default:
        return 'pending';
    }
  }
}
