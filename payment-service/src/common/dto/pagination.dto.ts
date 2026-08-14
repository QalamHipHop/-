// =============================================================================
//  Common DTOs
//  Author: Qalamhiphop
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ required: false, default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 50;
}

export class MoneyDto {
  @ApiProperty({ description: 'amount in minor units (cents)', example: '10000' })
  @IsString()
  amountMinor!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  currency!: string;
}
