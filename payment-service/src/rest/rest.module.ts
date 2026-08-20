import { Module } from '@nestjs/common';
import { RestController } from './rest.controller';
import { IntentsModule } from '../intents/intents.module';
import { InternalTokenGuard } from './internal-token.guard';

@Module({
  imports: [IntentsModule],
  controllers: [RestController],
  providers: [InternalTokenGuard],
})
export class RestModule {}
