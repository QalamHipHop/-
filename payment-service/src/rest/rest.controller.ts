// =============================================================================
//  REST controller (public + internal)
//  Author: QalamCode
// =============================================================================
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IntentsService } from '../intents/intents.service';
import { IntentJSON, IntentKind, IntentStatus } from '../intents/intent.entity';
import { AdapterRegistry, AdapterName } from '../adapters/adapter.registry';
import { CreateDepositRestDto, CreateWithdrawalRestDto } from './dto/rest.dto';
import { Money } from '../adapters/types';
import { PaginationDto } from '../common/dto/pagination.dto';
import { fromJSON } from '../adapters/types';

@ApiTags('payments')
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
  getIntent(@Param('id') id: string): IntentJSON {
    return this.intents.get(id);
  }

  @Get('intents')
  @ApiOperation({ summary: 'List intents' })
  listIntents(
    @Query('userId') userId?: string,
    @Query('kind') kind?: IntentKind,
    @Query('status') status?: IntentStatus,
    @Query() page: PaginationDto = { page: 1, pageSize: 50 } as PaginationDto,
  ): { items: IntentJSON[]; total: number; page: number; pageSize: number } {
    const r = this.intents.list({ userId, kind, status, page: page.page, pageSize: page.pageSize });
    return { items: r.items, total: r.total, page: page.page, pageSize: page.pageSize };
  }

  @Post('intents/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending intent' })
  async cancelIntent(@Param('id') id: string, @Body() body: { reason?: string }): Promise<IntentJSON> {
    return this.intents.cancel(id, body?.reason);
  }
}
