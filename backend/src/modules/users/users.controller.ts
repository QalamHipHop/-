import { Controller, Get, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { UsersService } from './users.service';
import { AuthenticatedUser } from '../auth/types';

interface AuthedRequest extends FastifyRequest { user?: AuthenticatedUser }

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@Req() req: AuthedRequest) {
    return this.users.profile(req.user!.sub);
  }

  @Get('me/identities')
  async myIdentities(@Req() req: AuthedRequest) {
    return this.users.listIdentities(req.user!.sub);
  }

  @Get('me/sessions')
  async mySessions(@Req() req: AuthedRequest) {
    return this.users.listSessions(req.user!.sub);
  }
}
