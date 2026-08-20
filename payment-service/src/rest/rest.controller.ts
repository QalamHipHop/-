// =============================================================================
//  REST controller (public + internal)
//  Author: Qalamhiphop
// =============================================================================
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IntentsService } from '../intents/intents.service';
import { IntentJSON, IntentKind, IntentStatus } from '../intents/intent.entity';
import { AdapterRegistry, AdapterName } from '../adapters/adapter.registry';
import { CreateDepositRestDto, CreateWithdrawalRestDto } from './dto/rest.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { fromJSON } from '../adapters/types';
import { InternalTokenGuard } from './internal-token.guard';

@ApiTags('payments')
@UseGuards(InternalTokenGuard)
@Controller('v1')
export class RestController {
  constructor(
    private readonly intents: IntentsService,
    private readonly registry: AdapterRegistry,
  ) {}

  @Get('adapters')
  @ApiOperation({ summary: 'List enabled payment adapters' })
  listAdapters(): { items: { name: AdapterName; enabled: boolean; sandbox: boolean }[] } {
    return { items: this.registry.list() };
  }

  @Post('deposits')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a deposit intent' })
  async createDeposit(@Body() body: CreateDepositRestDto): Promise<IntentJSON> {
    return this.intents.createDeposit({
      userId: body.userId,
      adapter: body.adapter,
      amount: fromJSON({ amountMinor: body.amount.amountMinor, currency: body.amount.currency }),
      reference: body.reference,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata,
      returnUrl: body.returnUrl,
    });
  }

  @Post('withdrawals')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a withdrawal request' })
  async createWithdrawal(@Body() body: CreateWithdrawalRestDto): Promise<IntentJSON> {
    return this.intents.createWithdrawal({
      userId: body.userId,
      adapter: body.adapter,
      amount: fromJSON({ amountMinor: body.amount.amountMinor, currency: body.amount.currency }),
      destination: body.destination,
      reference: body.reference,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata,
    });
  }

  @Get('intents/:id')
  @ApiOperation({ summary: 'Get an intent by id' })
  async getIntent(@Param('id') id: string): Promise<IntentJSON> {
    return this.intents.get(id);
  }

  @Get('intents')
  @ApiOperation({ summary: 'List intents' })
  async listIntents(
    @Query('userId') userId?: string,
    @Query('kind') kind?: IntentKind,
    @Query('status') status?: IntentStatus,
    @Query() page: PaginationDto = { page: 1, pageSize: 50 } as PaginationDto,
  ): Promise<{ items: IntentJSON[]; total: number; page: number; pageSize: number }> {
    const r = await this.intents.list({ userId, kind, status, page: page.page, pageSize: page.pageSize });
    return { items: r.items, total: r.total, page: page.page, pageSize: page.pageSize };
  }

  @Post('intents/:id/refund')
  @HttpCode(201)
  @ApiOperation({ summary: 'Request an idempotent refund for a succeeded deposit' })
  async refundIntent(@Param('id') id: string, @Body() body: { userId: string; amount?: { amountMinor: string; currency: string }; reason: string; idempotencyKey: string }) {
    return this.intents.refund(id, body.userId, body.amount ? fromJSON(body.amount) : undefined, body.reason, body.idempotencyKey);
  }

  @Get('intents/:id/refunds')
  @ApiOperation({ summary: 'List refunds for an intent' })
  async listRefunds(@Param('id') id: string, @Query('userId') userId: string) {
    return this.intents.listRefunds(id, userId);
  }

  @Post('intents/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending intent' })
  async cancelIntent(@Param('id') id: string, @Body() body: { reason?: string }): Promise<IntentJSON> {
    return this.intents.cancel(id, body?.reason);
  }
}
