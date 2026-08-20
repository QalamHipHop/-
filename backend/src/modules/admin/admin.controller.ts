import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminService, AdminUserStatus } from './admin.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

interface AdminRequest extends FastifyRequest { user?: { sub: string } }

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'moderator')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly reconciliation: ReconciliationService) {}

  @Get('stats')
  async stats() { return this.admin.stats(); }

  @Get('flagged-tokens')
  async flaggedTokens() { return this.admin.flaggedTokens(); }

  @Get('users')
  @Roles('admin')
  async users(@Query('status') status?: AdminUserStatus, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.admin.users({ status, limit: limit ? Number(limit) : undefined, offset: offset ? Number(offset) : undefined });
  }

  @Patch('users/:id/status')
  @Roles('admin')
  async setUserStatus(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: { status: AdminUserStatus; reason: string }) {
    return this.admin.setUserStatus(req.user!.sub, id, body.status, body.reason);
  }

  @Get('reconciliation/findings')
  @Roles('admin')
  async reconciliationFindings(@Query('limit') limit?: string) {
    return this.reconciliation.listOpenFindings(limit ? Number(limit) : 100);
  }

  @Patch('reconciliation/run')
  @Roles('admin')
  async reconciliationRun(@Req() req: AdminRequest, @Body() body: { scope?: 'wallet' | 'full' }) {
    return this.reconciliation.run(body.scope ?? 'wallet', req.user!.sub);
  }

  @Get('settings')
  @Roles('admin')
  async settings() { return this.admin.settings(); }

  @Patch('settings/:key')
  @Roles('admin')
  async updateSetting(@Req() req: AdminRequest, @Param('key') key: string, @Body() body: { value: unknown; reason: string }) {
    return this.admin.updateSetting(req.user!.sub, key, body.value, body.reason);
  }
}
