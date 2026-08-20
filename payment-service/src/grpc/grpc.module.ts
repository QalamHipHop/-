import { Module } from '@nestjs/common';
import { GrpcController } from './grpc.controller';
import { GrpcInternalAuthGuard } from './grpc-internal-auth.guard';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [IntentsModule],
  controllers: [GrpcController],
  providers: [GrpcInternalAuthGuard],
})
export class GrpcModule {}
