/**
 *  GraphQL configuration — code-first, Apollo Server v4, with persisted queries off by default.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlOptionsFactory } from '@nestjs/graphql';
import { ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { join } from 'path';

@Injectable()
export class GraphQLConfigService implements GqlOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createGqlOptions(): ApolloDriverConfig {
    const isProd = this.config.get<string>('app.env') === 'production';
    return {
      autoSchemaFile: join(process.cwd(), 'schema.gql'),
      sortSchema: true,
      playground: false, // replaced by Apollo landing page
      introspection: !isProd,
      path: '/graphql',
      installSubscriptionHandlers: false,
      context: ({ req, res, connectionParams, extra }: { req?: unknown; res?: unknown; connectionParams?: Record<string, unknown>; extra?: unknown }) => ({
        req,
        res,
        connectionParams,
        extra,
      }),
      plugins: isProd ? [] : [ApolloServerPluginLandingPageLocalDefault({ embed: true })],
      subscriptions: {
        'graphql-ws': {
          // auth happens inside resolver via JwtAuthGuard; WS handshake validated at gateway level
          path: '/graphql',
        },
      },
    };
  }
}
