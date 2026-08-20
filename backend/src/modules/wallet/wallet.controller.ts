/**
 *  WalletController — REST surface for /api/wallet
 *  - GET  /api/wallet/summary
 *  - GET  /api/wallet/balance?asset=RIAL
 *  - GET  /api/wallet/transactions
 *  - POST /api/wallet/transfer       (internal transfer)
 *  - POST /api/wallet/withdraw       (initiates external withdrawal)
 *  - GET  /api/wallet/multisig
 *  - POST /api/wallet/multisig       (admin: create proposal)
 *  - POST /api/wallet/multisig/:id/sign
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WalletService } from './wallet.service';
import { PaymentClient } from './payment.client';
import { CustodyClient } from './custody.client';
import type { Currency } from './wallet.types';

class TransferDto {
  @IsOptional() @IsString() toUserId?: string;
  @IsString() currency!: Currency;
  @IsString() amount!: string;
  @IsString() reason!: string;
  @IsOptional() @IsString() clientId?: string;
}

class DepositDto {
  @IsIn(['manual', 'stripe', 'zarinpal', 'nowpayments']) adapter!: string;
  @IsString() amountMinor!: string;
  @IsString() currency!: Currency;
  @IsString() @Length(1, 128) reference!: string;
  @IsString() @Length(8, 128) idempotencyKey!: string;
  @IsOptional() @IsString() returnUrl?: string;
}

class WithdrawalDestinationDto {
  @IsIn(['evm', 'solana', 'btc', 'iban']) chain!: 'evm' | 'solana' | 'btc' | 'iban';
  @IsString() destination!: string;
  @IsOptional() @IsString() label?: string;
}

class ConfirmWithdrawalDestinationDto {
  @IsString() @Length(32, 128) token!: string;
}

class WithdrawDto {
  @IsString() @IsIn(['RIAL']) currency!: Currency;
  @IsIn(['evm', 'solana', 'btc', 'iban']) chain!: 'evm' | 'solana' | 'btc' | 'iban';
  @IsString() amount!: string;
  @IsString() destination!: string; // chain:address or bank ref
  @IsOptional() @IsString() memo?: string;
  @IsString() @Length(8, 128) clientId!: string;
}

class MultisigDto {
  @IsString() chain!: string;
  @IsString() toAddress!: string;
  @IsString() amount!: string;
  @IsString() currency!: Currency;
  @IsInt() @Min(1) threshold!: number;
  @IsOptional() @IsString() dataHex?: string;
  @IsOptional() @IsInt() ttlSeconds?: number;
}

class SignDto {
  @IsString() signer!: string;
  @IsString() signatureHex!: string;
}

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService, private readonly payments: PaymentClient, private readonly custody: CustodyClient) {}

  @Post('deposit')
  async deposit(@Req() req: any, @Body() dto: DepositDto) {
    return this.payments.createDeposit({
      userId: req.user.id,
      adapter: dto.adapter,
      amount: { amountMinor: dto.amountMinor, currency: dto.currency },
      reference: dto.reference,
      idempotencyKey: dto.idempotencyKey,
      returnUrl: dto.returnUrl,
    });
  }

  @Get('summary')
  async summary(@Req() req: any) {
    return this.wallet.getSummary(req.user.id);
  }

  @Get('balance')
  async balance(@Req() req: any, @Query('asset') asset = 'RIAL') {
    return this.wallet.getBalance(req.user.id, asset);
  }

  @Get('transactions')
  async tx(@Req() req: any, @Query('limit') limit?: string, @Query('type') type?: any) {
    return this.wallet.listTransactions(req.user.id, { limit: limit ? Number(limit) : undefined, type });
  }

  @Post('transfer')
  async transfer(@Req() req: any, @Body() dto: TransferDto) {
    return this.wallet.transfer({
      userId: req.user.id,
      toUserId: dto.toUserId,
      currency: dto.currency,
      amountMinor: dto.amount,
      reason: dto.reason,
      clientId: dto.clientId,
    });
  }

  @Get('withdrawal-destinations')
  async listWithdrawalDestinations(@Req() req: any) {
    return this.custody.listWithdrawalDestinations(req.user.id);
  }

  @Post('withdrawal-destinations')
  async createWithdrawalDestination(@Req() req: any, @Body() dto: WithdrawalDestinationDto) {
    return this.custody.createWithdrawalDestination({ userId: req.user.id, chain: dto.chain, destination: dto.destination, label: dto.label });
  }

  @Post('withdrawal-destinations/:id/confirm')
  async confirmWithdrawalDestination(@Req() req: any, @Param('id') id: string, @Body() dto: ConfirmWithdrawalDestinationDto) {
    return this.custody.confirmWithdrawalDestination({ userId: req.user.id, id, token: dto.token });
  }

  @Post('withdrawal-destinations/:id/revoke')
  async revokeWithdrawalDestination(@Req() req: any, @Param('id') id: string) {
    return this.custody.revokeWithdrawalDestination({ userId: req.user.id, id });
  }

  @Post('withdraw')
  async withdraw(@Req() req: any, @Body() dto: WithdrawDto) {
    return this.custody.requestWithdrawal({
      userId: req.user.id,
      amount: dto.amount,
      chain: dto.chain,
      destination: dto.destination,
      idempotencyKey: dto.clientId,
    });
  }

  @Get('multisig')
  @Roles('admin', 'treasury')
  async listProposals(@Query('status') status?: any) {
    return this.wallet.listProposals({ status });
  }

  @Post('multisig')
  @Roles('admin', 'treasury')
  async createProposal(@Req() req: any, @Body() dto: MultisigDto) {
    return this.wallet.createProposal({
      chain: dto.chain,
      toAddress: dto.toAddress,
      amountMinor: dto.amount,
      currency: dto.currency,
      threshold: dto.threshold,
      data: dto.dataHex ? Buffer.from(dto.dataHex.replace(/^0x/, ''), 'hex') : undefined,
      createdBy: req.user.id,
      ttlSeconds: dto.ttlSeconds,
    });
  }

  @Post('multisig/:id/sign')
  @Roles('admin', 'treasury')
  async sign(@Param('id') id: string, @Body() dto: SignDto) {
    return this.wallet.signProposal(id, dto.signer, Buffer.from(dto.signatureHex.replace(/^0x/, ''), 'hex'));
  }
}
