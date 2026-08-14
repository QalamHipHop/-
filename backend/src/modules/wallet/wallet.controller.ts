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
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WalletService } from './wallet.service';
import type { Currency } from './wallet.types';

class TransferDto {
  @IsOptional() @IsString() toUserId?: string;
  @IsString() currency!: Currency;
  @IsString() amount!: string;
  @IsString() reason!: string;
  @IsOptional() @IsString() clientId?: string;
}

class WithdrawDto {
  @IsString() currency!: Currency;
  @IsString() amount!: string;
  @IsString() destination!: string; // chain:address or bank ref
  @IsOptional() @IsString() memo?: string;
  @IsOptional() @IsString() clientId?: string;
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
  constructor(private readonly wallet: WalletService) {}

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

  @Post('withdraw')
  async withdraw(@Req() req: any, @Body() dto: WithdrawDto) {
    // Withdrawal pipeline: creates pending tx + multi-sig proposal if hot wallet drain
    const userId = req.user.id;
    const tx = await this.wallet.debit({
      userId, currency: dto.currency, amountMinor: dto.amount,
      reason: 'withdraw', type: 'withdraw', clientId: dto.clientId,
      meta: { destination: dto.destination, memo: dto.memo, status: 'pending' },
    });
    return { txId: tx.txId, status: 'pending' };
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
