import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRepository } from '../auth/user.repository';
import { SessionService } from '../auth/session.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserRepository, SessionService],
  exports: [UsersService],
})
export class UsersModule {}
