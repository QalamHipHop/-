// =============================================================================
//  REST DTOs with validation
//  Author: QalamCode
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MoneyDto } from '../../common/dto/pagination.dto';

export class CreateDepositRestDto {
  @ApiProperty({ example: 'usr_123' })
  @IsString()
  @Length(1, 128)
  userId!: string;

  @ApiProperty({ enum: ['manual', 'stripe', 'zarinpal', 'nowpayments'] })
  @IsIn(['manual', 'stripe', 'zarinpal', 'nowpayments'])
  adapter!: string;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  amount!: MoneyDto;

  @ApiProperty({ example: 'order_abc' })
  @IsString()
  @Length(1, 128)
  reference!: string;

  @ApiProperty({ example: 'idem_xyz' })
  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  returnUrl?: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}

export class CreateWithdrawalRestDto {
  @ApiProperty({ example: 'usr_123' })
  @IsString()
  @Length(1, 128)
  userId!: string;

  @ApiProperty({ enum: ['manual', 'stripe', 'zarinpal', 'nowpayments'] })
  @IsIn(['manual', 'stripe', 'zarinpal', 'nowpayments'])
  adapter!: string;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  amount!: MoneyDto;

  @ApiProperty({ example: 'IR820540102680020817569002' })
  @IsString()
  @Length(4, 256)
  destination!: string;

  @ApiProperty({ example: 'withdraw_001' })
  @IsString()
  @Length(1, 128)
  reference!: string;

  @ApiProperty({ example: 'idem_xyz' })
  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
