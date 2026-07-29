import { Module } from '@nestjs/common';
import { GrpcController } from './grpc.controller';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [IntentsModule],
  controllers: [GrpcController],
})
export class GrpcModule {}
