// =============================================================================
//  gRPC controller — internal RIAL payment service contract
//  Author: Qalamhiphop
// =============================================================================
import { Controller, UseGuards } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { IntentsService } from '../intents/intents.service';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { Money } from '../adapters/types';
import { IntentJSON } from '../intents/intent.entity';
import { GrpcInternalAuthGuard } from './grpc-internal-auth.guard';

interface MoneyProto {
  amountMinor: string;
  currency: string;
}

interface CreateDepositProto {
  userId: string;
  adapter: number; // enum index
  amount: MoneyProto;
  reference: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  returnUrl: string;
}

interface CreateWithdrawalProto {
  userId: string;
  adapter: number;
  amount: MoneyProto;
  destination: string;
  reference: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

interface IntentProtoOut {
  id: string;
  kind: number;
  userId: string;
  adapter: number;
  status: number;
  amount: MoneyProto;
  settledAmount?: MoneyProto;
  reference: string;
  externalId: string;
  redirectUrl: string;
  qrCode: string;
  failureReason: string;
  metadata: Record<string, string>;
  createdAt: number; // unix seconds
  updatedAt: number;
  expiresAt: number;
}

const ADAPTER_TO_ENUM: Record<string, number> = {
  manual: 1,
  stripe: 2,
  zarinpal: 3,
  nowpayments: 4,
  internal: 5,
};

const ENUM_TO_ADAPTER: Record<number, string> = Object.fromEntries(
  Object.entries(ADAPTER_TO_ENUM).map(([k, v]) => [v, k]),
);

@UseGuards(GrpcInternalAuthGuard)
@Controller()
export class GrpcController {
  constructor(
    private readonly intents: IntentsService,
    private readonly registry: AdapterRegistry,
  ) {}

  @GrpcMethod('PaymentService', 'CreateDeposit')
  async createDeposit(req: CreateDepositProto): Promise<{
    intentId: string;
    status: number;
    amount: MoneyProto;
    adapter: number;
    redirectUrl: string;
    qrCode: string;
    adapterPayload: Record<string, string>;
    expiresAt: number;
  }> {
    const adapter = ENUM_TO_ADAPTER[req.adapter];
    if (!adapter) throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: 'unknown adapter' });
    const result = await this.intents.createDeposit({
      userId: req.userId,
      adapter,
      amount: this.toMoney(req.amount),
      reference: req.reference,
      idempotencyKey: req.idempotencyKey,
      metadata: req.metadata ?? {},
      returnUrl: req.returnUrl || undefined,
    });
    return {
      intentId: result.id,
      status: this.statusToEnum(result.status),
      amount: req.amount,
      adapter: req.adapter,
      redirectUrl: result.redirectUrl ?? '',
      qrCode: result.qrCode ?? '',
      adapterPayload: {},
      expiresAt: result.expiresAt ? Math.floor(new Date(result.expiresAt).getTime() / 1000) : 0,
    };
  }

  @GrpcMethod('PaymentService', 'CreateWithdrawal')
  async createWithdrawal(req: CreateWithdrawalProto): Promise<{
    withdrawalId: string;
    status: number;
    amount: MoneyProto;
    adapter: number;
    reference: string;
    createdAt: number;
  }> {
    const adapter = ENUM_TO_ADAPTER[req.adapter];
    if (!adapter) throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: 'unknown adapter' });
    const result = await this.intents.createWithdrawal({
      userId: req.userId,
      adapter,
      amount: this.toMoney(req.amount),
      destination: req.destination,
      reference: req.reference,
      idempotencyKey: req.idempotencyKey,
      metadata: req.metadata ?? {},
    });
    return {
      withdrawalId: result.id,
      status: this.statusToEnum(result.status),
      amount: req.amount,
      adapter: req.adapter,
      reference: result.reference,
      createdAt: Math.floor(new Date(result.createdAt).getTime() / 1000),
    };
  }

  @GrpcMethod('PaymentService', 'GetIntent')
  async getIntent(req: { intentId: string }): Promise<IntentProtoOut> {
    const i = await this.intents.get(req.intentId);
    return this.intentToProto(i);
  }

  @GrpcMethod('PaymentService', 'ListIntents')
  async listIntents(req: {
    userId: string;
    kind: number;
    status: number;
    page: number;
    pageSize: number;
  }): Promise<{ intents: IntentProtoOut[]; total: number }> {
    const r = await this.intents.list({
      userId: req.userId || undefined,
      kind: this.kindFromEnum(req.kind),
      status: this.statusFromEnum(req.status),
      page: req.page || 1,
      pageSize: req.pageSize || 50,
    });
    return { intents: r.items.map((i) => this.intentToProto(i)), total: r.total };
  }

  @GrpcMethod('PaymentService', 'CancelIntent')
  async cancelIntent(req: { intentId: string; reason: string }): Promise<IntentProtoOut> {
    const i = await this.intents.cancel(req.intentId, req.reason);
    return this.intentToProto(i);
  }

  @GrpcMethod('PaymentService', 'HandleWebhook')
  handleWebhook(req: {
    id: string;
    adapter: number;
    eventType: string;
    rawBody: Buffer;
    headers: Record<string, string>;
    signature: string;
  }): IntentProtoOut {
    const adapter = ENUM_TO_ADAPTER[req.adapter];
    if (!adapter) throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: 'unknown adapter' });
    // Reuse IntentsService via webhook flow implemented in WebhooksController
    // For gRPC, the webhook handling is delegated to the HTTP webhook handler.
    throw new RpcException({ code: GrpcStatus.UNIMPLEMENTED, message: 'use HTTP webhook endpoint' });
  }

  @GrpcMethod('PaymentService', 'ListAdapters')
  listAdapters(): { adapters: { adapter: number; name: string; enabled: boolean; sandbox: boolean; supportedFiats: string[]; supportedAssets: string[] }[] } {
    const items = this.registry.list();
    return {
      adapters: items.map((i) => {
        const full = this.registry.get(i.name);
        return {
          adapter: ADAPTER_TO_ENUM[i.name] ?? 0,
          name: full.info.name,
          enabled: i.enabled,
          sandbox: i.sandbox,
          supportedFiats: full.info.supportedFiats,
          supportedAssets: full.info.supportedAssets,
        };
      }),
    };
  }

  private toMoney(m: MoneyProto): Money {
    return { amountMinor: BigInt(m.amountMinor), currency: m.currency };
  }

  private statusToEnum(s: IntentJSON['status']): number {
    switch (s) {
      case 'pending': return 1;
      case 'processing': return 2;
      case 'succeeded': return 3;
      case 'failed': return 4;
      case 'cancelled': return 5;
      case 'refunded': return 6;
      case 'expired': return 7;
      default: return 0;
    }
  }

  private statusFromEnum(n: number): IntentJSON['status'] | undefined {
    switch (n) {
      case 1: return 'pending';
      case 2: return 'processing';
      case 3: return 'succeeded';
      case 4: return 'failed';
      case 5: return 'cancelled';
      case 6: return 'refunded';
      case 7: return 'expired';
      default: return undefined;
    }
  }

  private kindFromEnum(n: number): IntentJSON['kind'] | undefined {
    switch (n) {
      case 1: return 'deposit';
      case 2: return 'withdrawal';
      default: return undefined;
    }
  }

  private intentToProto(i: IntentJSON): IntentProtoOut {
    return {
      id: i.id,
      kind: i.kind === 'deposit' ? 1 : 2,
      userId: i.userId,
      adapter: ADAPTER_TO_ENUM[i.adapter] ?? 0,
      status: this.statusToEnum(i.status),
      amount: { amountMinor: i.amount.amountMinor, currency: i.amount.currency },
      settledAmount: i.settledAmount
        ? { amountMinor: i.settledAmount.amountMinor, currency: i.settledAmount.currency }
        : undefined,
      reference: i.reference,
      externalId: i.externalId ?? '',
      redirectUrl: i.redirectUrl ?? '',
      qrCode: i.qrCode ?? '',
      failureReason: i.failureReason ?? '',
      metadata: i.metadata,
      createdAt: Math.floor(new Date(i.createdAt).getTime() / 1000),
      updatedAt: Math.floor(new Date(i.updatedAt).getTime() / 1000),
      expiresAt: i.expiresAt ? Math.floor(new Date(i.expiresAt).getTime() / 1000) : 0,
    };
  }
}
