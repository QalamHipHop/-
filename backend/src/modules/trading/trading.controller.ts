/**
 *  TradingController — /api/trading
 *  - GET  /api/trading/markets
 *  - POST /api/trading/markets        (admin)
 *  - GET  /api/trading/markets/:id
 *  - GET  /api/trading/markets/:id/orderbook
 *  - GET  /api/trading/markets/:id/trades
 *  - GET  /api/trading/markets/:id/candles?interval=1m
 *  - POST /api/trading/orders
 *  - DELETE /api/trading/orders/:id
 *  - GET  /api/trading/orders
 */
import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TradingService } from './trading.service';

class CreateMarketDto {
  @IsString() chain!: string;
  @IsString() base!: string;
  @IsOptional() @IsString() quote?: string;
  @IsIn(['spot', 'perp', 'launch']) kind!: 'spot' | 'perp' | 'launch';
  @IsOptional() @IsString() tokenId?: string;
  @IsString() tickMinor!: string;
  @IsString() lotMinor!: string;
}

class PlaceOrderDto {
  @IsString() marketId!: string;
  @IsIn(['buy', 'sell']) side!: 'buy' | 'sell';
  @IsIn(['market', 'limit', 'stop', 'stop_limit', 'iceberg', 'trailing', 'oco']) type!: 'market' | 'limit' | 'stop' | 'stop_limit' | 'iceberg' | 'trailing' | 'oco';
  @IsOptional() @IsIn(['GTC', 'IOC', 'FOK', 'GTD']) timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'GTD';
  @IsOptional() @IsString() priceMinor?: string;
  @IsOptional() @IsString() stopPriceMinor?: string;
  @IsString() amountMinor!: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsBoolean() reduceOnly?: boolean;
  @IsOptional() @IsBoolean() postOnly?: boolean;
}

@Controller('trading')
@UseGuards(JwtAuthGuard)
export class TradingController {
  constructor(private readonly trading: TradingService) {}

  @Get('markets')
  @Roles()
  async listMarkets(@Query('kind') kind?: string, @Query('chain') chain?: string) {
    return this.trading.listMarkets({ kind: kind as any, chain });
  }

  @Get('markets/:id')
  async market(@Param('id') id: string) {
    return this.trading.getMarket(id);
  }

  @Get('markets/:id/orderbook')
  async book(@Param('id') id: string, @Query('depth') depth?: string) {
    return this.trading.getOrderBook(id, depth ? Number(depth) : 20);
  }

  @Get('markets/:id/trades')
  async trades(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.trading.listTrades(id, { limit: limit ? Number(limit) : 100 });
  }

  @Get('markets/:id/candles')
  async candles(@Param('id') id: string, @Query('interval') interval = '1m', @Query('limit') limit?: string) {
    return this.trading.getCandles(id, interval, limit ? Number(limit) : 500);
  }

  @Post('markets')
  @Roles('admin')
  async createMarket(@Body() dto: CreateMarketDto) {
    return this.trading.createMarket(dto);
  }

  @Post('orders')
  async placeOrder(@Req() req: any, @Body() dto: PlaceOrderDto) {
    return this.trading.placeOrder({
      userId: req.user.id,
      marketId: dto.marketId,
      side: dto.side,
      type: dto.type,
      timeInForce: dto.timeInForce,
      priceMinor: dto.priceMinor,
      stopPriceMinor: dto.stopPriceMinor,
      amountMinor: dto.amountMinor,
      clientId: dto.clientId,
      reduceOnly: dto.reduceOnly,
      postOnly: dto.postOnly,
    });
  }

  @Delete('orders/:id')
  async cancelOrder(@Req() req: any, @Param('id') id: string) {
    return this.trading.cancelOrder(req.user.id, id);
  }

  @Get('orders')
  async listOrders(@Req() req: any, @Query('marketId') marketId?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.trading.listUserOrders(req.user.id, { marketId, status: status as any, limit: limit ? Number(limit) : 50 });
  }
}
