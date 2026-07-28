/**
 *  GraphQL resolver — mirrors the REST surface for the BFF.
 *  Uses code-first schema; @Public() to skip JWT guard on mutations.
 */
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Public } from '../../common/guards/jwt-auth.guard';

import { AuthService } from './auth.service';
import { TokenPair } from './token.service';
import { AuthenticatedUser, UserPublic } from './types';

@Resolver(() => UserPublic)
export class AuthResolver {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Mutation(() => TokenPairGql, { name: 'authRegister' })
  async register(
    @Args('email', { nullable: true }) email?: string,
    @Args('phone', { nullable: true }) phone?: string,
    @Args('username', { nullable: true }) username?: string,
    @Args('password') password?: string,
  ): Promise<TokenPairGql> {
    const pair = await this.auth.register({ email, phone, username, password: password ?? '' });
    return pair;
  }

  @Public()
  @Mutation(() => TokenPairGql, { name: 'authLogin' })
  async login(
    @Args('identifier') identifier: string,
    @Args('password') password: string,
    @Args('mfaCode', { nullable: true }) mfaCode?: string,
    @Context() ctx?: { req: { ip: string; headers: Record<string, string> } },
  ): Promise<TokenPairGql> {
    const ip = ctx?.req?.ip ?? '0.0.0.0';
    const ua = ctx?.req?.headers?.['user-agent'] ?? 'graphql';
    const pair = await this.auth.login({ identifier, password, mfaCode, ip, userAgent: ua });
    return pair;
  }

  @Query(() => UserPublic, { name: 'me' })
  async me(@Context() ctx: { req: { user?: AuthenticatedUser } }): Promise<UserPublic | null> {
    const u = ctx.req.user;
    if (!u) return null;
    const user = await this.auth.me(u.sub);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      username: user.username ?? undefined,
      status: user.status as UserPublic['status'],
      kycLevel: user.kyc_level as UserPublic['kycLevel'],
      countryCode: user.country_code ?? undefined,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }
}

// Local GQL mirror type (avoids circular import with token.service.ts)
import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType('TokenPair')
export class TokenPairGql {
  @Field() accessToken!: string;
  @Field() refreshToken!: string;
  @Field() accessExpiresIn!: number;
  @Field() refreshExpiresIn!: number;
  @Field() tokenType!: string;
}
