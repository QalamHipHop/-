// =============================================================================
//  Webhooks — receives provider callbacks and reconciles intent status
//  Author: Qalamhiphop
// =============================================================================
import { BadRequestException, Body, Controller, Headers, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { IntentsService } from '../intents/intents.service';
import { IntentJSON, IntentStatus, intentToJSON } from '../intents/intent.entity';
import { IntentStore } from '../intents/intent.store';
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
    private readonly store: IntentStore,
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
      const parsed = await a.parseWebhook(raw, headers, signature);
      // ZarinPal callbacks are unsigned by design; Status=OK is only a browser
      // redirect signal. The payment API verification is the authority for credit.
      const verify = adapter === 'zarinpal' ? await a.verify(parsed.externalId) : parsed;
      const eventType = headers['x-event-type'] ?? headers['x-webhook-event'] ?? verify.status;
      const inserted = await this.store.recordWebhookEvent({
        id: `wh_${adapter}_${verify.externalId}_${eventType}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120),
        adapter,
        externalId: verify.externalId,
        type: eventType,
        payload: { status: verify.status, settledAmount: verify.settledAmount, failureReason: verify.failureReason },
      });
      if (!inserted) {
        if (await this.store.isWebhookProcessed(adapter, verify.externalId, eventType) || !(await this.store.claimWebhookEvent(adapter, verify.externalId, eventType))) {
          const existing = await this.intents.findByExternalId(adapter, verify.externalId);
          return { ok: true, intent: existing ? intentToJSON(existing) : null };
        }
      }
      const existing = await this.intents.findByExternalId(adapter, verify.externalId);
      if (!existing) {
        await this.store.markWebhookProcessed(adapter, verify.externalId, eventType);
        return { ok: true, intent: null };
      }
      const status = this.mapStatus(verify.status);
      const updated = await this.intents.applyVerifyResult(
        existing.id,
        status,
        verify.settledAmount,
        verify.failureReason,
      );
      await this.store.markWebhookProcessed(adapter, verify.externalId, eventType);
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
