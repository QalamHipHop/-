import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { LaunchpadController } from './launchpad.controller';
import { LaunchpadService } from './launchpad.service';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [LaunchpadController],
  providers: [LaunchpadService],
})
export class LaunchpadModule {}
