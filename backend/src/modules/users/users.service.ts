import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../auth/user.repository';
import { SessionService } from '../auth/session.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
  ) {}

  async profile(userId: string) {
    const u = await this.users.findById(userId);
    if (!u) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    const { password_hash, ...safe } = u;
    return safe;
  }

  async listIdentities(userId: string) {
    return this.users.listIdentities(userId);
  }

  async listSessions(userId: string) {
    return this.sessions.list(userId);
  }
}
