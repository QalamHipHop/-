import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/guards/jwt-auth.guard';
import { LaunchpadService } from './launchpad.service';

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
}
