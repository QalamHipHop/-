import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BANNED = 'banned',
  PENDING = 'pending',
}
registerEnumType(UserStatus, { name: 'UserStatus' });

export enum KycLevel {
  NONE = 0,
  EMAIL = 1,
  PHONE = 2,
  ID = 3,
  ENHANCED = 4,
}
registerEnumType(KycLevel, { name: 'KycLevel' });

export interface AuthenticatedUser {
  sub: string;            // user id (uuid)
  username?: string;
  email?: string;
  roles?: string[];
  scopes?: string[];
  kyc?: number;
  iat?: number;
  exp?: number;
  jti?: string;
}

@ObjectType()
export class UserPublic {
  @Field(() => ID) id!: string;
  @Field({ nullable: true }) email?: string;
  @Field({ nullable: true }) phone?: string;
  @Field({ nullable: true }) username?: string;
  @Field(() => UserStatus) status!: UserStatus;
  @Field(() => KycLevel) kycLevel!: KycLevel;
  @Field({ nullable: true }) countryCode?: string;
  @Field() createdAt!: Date;
  @Field() updatedAt!: Date;
}
