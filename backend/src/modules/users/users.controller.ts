import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { UsersService } from './users.service';
import { AuthenticatedUser } from '../auth/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

interface AuthedRequest extends FastifyRequest { user?: AuthenticatedUser }

@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ---------------------------------------------------------- profile

  @Get('me')
  async me(@Req() req: AuthedRequest) {
    return this.users.profile(req.user!.sub);
  }

  @Put('me')
  async updateMe(
    @Req() req: AuthedRequest,
    @Body() body: { displayName?: string; avatarUrl?: string; bio?: string; countryCode?: string },
  ) {
    return this.users.updateProfile(req.user!.sub, body);
  }

  // ----------------------------------------------------- preferences

  @Get('me/preferences')
  async getPreferences(@Req() req: AuthedRequest) {
    return this.users.getPreferences(req.user!.sub);
  }

  @Put('me/preferences')
  async updatePreferences(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    return this.users.updatePreferences(req.user!.sub, body);
  }

  // -------------------------------------------------------------- KYC

  @Post('me/kyc')
  async submitKyc(
    @Req() req: AuthedRequest,
    @Body() body: { fullName: string; dob: string; countryCode: string; documentType: string; documentNumber: string; selfieRef?: string },
  ) {
    return this.users.submitKyc(req.user!.sub, body);
  }

  @Get('me/kyc')
  async kycStatus(@Req() req: AuthedRequest) {
    return this.users.kycStatus(req.user!.sub);
  }

  // --------------------------------------------------------- identities

  @Get('me/identities')
  async myIdentities(@Req() req: AuthedRequest) {
    return this.users.listIdentities(req.user!.sub);
  }

  @Delete('me/identities/:provider/:uid')
  async detachIdentity(
    @Req() req: AuthedRequest,
    @Param('provider') provider: string,
    @Param('uid') uid: string,
  ) {
    await this.users.detachIdentity(req.user!.sub, provider, uid);
    return { ok: true };
  }

  // ---------------------------------------------------------- sessions

  @Get('me/sessions')
  async mySessions(@Req() req: AuthedRequest) {
    return this.users.listSessions(req.user!.sub);
  }

  @Delete('me/sessions/:jti')
  async revokeSession(@Req() req: AuthedRequest, @Param('jti') jti: string) {
    await this.users.revokeSession(req.user!.sub, jti);
    return { ok: true };
  }

  @Post('me/sessions/revoke-all')
  async revokeAll(@Req() req: AuthedRequest) {
    const n = await this.users.revokeAllSessions(req.user!.sub, req.user!.jti);
    return { revoked: n };
  }

  // ------------------------------------------------------- admin paths

  @Get(':id')
  @Roles('admin', 'support')
  async getById(@Param('id') id: string) {
    return this.users.profile(id);
  }
}
