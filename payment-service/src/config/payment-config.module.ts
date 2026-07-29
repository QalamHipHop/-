import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, configuration } from './configuration';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  imports: [ConfigModule.forFeature(configuration)],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: (cs: ConfigService): AppConfig => cs.get<AppConfig>('app') ?? configuration(),
    },
  ],
  exports: [APP_CONFIG],
})
export class PaymentConfigModule {}
