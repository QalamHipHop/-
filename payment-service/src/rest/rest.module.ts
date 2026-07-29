import { Module } from '@nestjs/common';
import { RestController } from './rest.controller';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [IntentsModule],
  controllers: [RestController],
})
export class RestModule {}
