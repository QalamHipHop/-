import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LaunchpadController } from './launchpad.controller';
import { LaunchpadService } from './launchpad.service';

@Module({
  imports: [ConfigModule],
  controllers: [LaunchpadController],
  providers: [LaunchpadService],
})
export class LaunchpadModule {}
