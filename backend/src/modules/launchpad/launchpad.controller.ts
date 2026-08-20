import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';
import { JwtAuthGuard, Public } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { LaunchpadService } from './launchpad.service';

class CreateTokenDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() symbol!: string;
  @IsInt() @Min(0) decimals!: number;
  @IsString() @IsNotEmpty() total_supply!: string;
  @IsString() @IsNotEmpty() chain!: string;
  @IsOptional() @IsString() contract_address?: string;
  @IsOptional() @IsString() logo_url?: string;
  @IsOptional() @IsString() banner_url?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() telegram?: string;
  @IsOptional() @IsString() twitter?: string;
  @IsOptional() @IsString() discord?: string;
  @IsOptional() @IsString() github?: string;
  @IsOptional() @IsString() mint_authority?: string;
  @IsOptional() @IsString() freeze_authority?: string;
  @IsString() @IsNotEmpty() curve_model!: string;
  curve_params!: unknown;
  @IsString() @Matches(/^\d+$/) graduation_rial_minor!: string;
  @IsOptional() vesting?: unknown[];
}

class TradeDto {
  @IsString() @Matches(/^\d+$/) amount_in_minor!: string;
  @IsString() @IsNotEmpty() client_id!: string;
}

class ModerationDto {
  @IsOptional() @IsString() reason?: string;
}

@Controller('launchpad')
export class LaunchpadController {
  constructor(private readonly launchpad: LaunchpadService) {}

  @Public()
  @Get('tokens')
  async listTokens(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.launchpad.listTokens({
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Public()
  @Get('tokens/:id')
  async getToken(@Param('id') id: string) {
    return this.launchpad.getToken(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tokens')
  async createToken(@Req() req: any, @Body() dto: CreateTokenDto) {
    return this.launchpad.createToken(this.user(req), dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tokens/:id/quote-buy')
  async quoteBuy(@Req() req: any, @Param('id') id: string, @Body() dto: Pick<TradeDto, 'amount_in_minor'>) {
    return this.launchpad.quoteBuy(this.user(req), id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tokens/:id/buy')
  async buy(@Req() req: any, @Param('id') id: string, @Body() dto: TradeDto) {
    return this.launchpad.buy(this.user(req), id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tokens/:id/sell')
  async sell(@Req() req: any, @Param('id') id: string, @Body() dto: TradeDto) {
    return this.launchpad.sell(this.user(req), id, dto);
  }

  @Roles('admin')
  @Post('tokens/:id/approve')
  async approve(@Req() req: any, @Param('id') id: string) {
    return this.launchpad.approve(this.user(req), id);
  }

  @Roles('admin')
  @Post('tokens/:id/reject')
  async reject(@Req() req: any, @Param('id') id: string, @Body() dto: ModerationDto) {
    return this.launchpad.reject(this.user(req), id, dto);
  }

  @Roles('admin')
  @Post('tokens/:id/pause')
  async pause(@Req() req: any, @Param('id') id: string, @Body() dto: ModerationDto) {
    return this.launchpad.pause(this.user(req), id, dto);
  }

  private user(req: { user?: { sub?: string; roles?: string[] } }) {
    if (!req.user?.sub) throw new Error('Authenticated subject is missing');
    return { userId: req.user.sub, roles: req.user.roles ?? [] };
  }
}
