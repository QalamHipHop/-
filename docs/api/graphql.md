# GraphQL Schema (excerpt)

> Full SDL is generated from the NestJS code at build time. Mounted at `/graphql`.

```graphql
scalar DateTime
scalar UUID
scalar BigInt

type Query {
  me: User!
  myWallets: [WalletAccount!]!
  myOrders(status: OrderStatus, marketId: UUID, after: String, first: Int = 20): OrderConnection!

  markets(quote: String, after: String, first: Int = 20): MarketConnection!
  market(id: UUID!): Market
  orderBook(marketId: UUID!, depth: Int = 20): OrderBook!
  candles(marketId: UUID!, interval: Interval!, from: DateTime!, to: DateTime!): [Candle!]!

  tokens(status: TokenStatus, query: String, after: String, first: Int = 20): TokenConnection!
  token(id: UUID!): Token
  tokenHolders(tokenId: UUID!, after: String, first: Int = 50): HolderConnection!
}

type Mutation {
  createToken(input: CreateTokenInput!): Token!
  buyOnCurve(input: TradeOnCurveInput!): TradeReceipt!
  sellOnCurve(input: TradeOnCurveInput!): TradeReceipt!

  placeOrder(input: PlaceOrderInput!): Order!
  cancelOrder(id: UUID!): Order!
  modifyOrder(id: UUID!, input: ModifyOrderInput!): Order!

  createDeposit(input: CreateDepositInput!): DepositIntent!
  createWithdrawal(input: CreateWithdrawalInput!): WithdrawalIntent!
}

type Subscription {
  orderBook(marketId: UUID!): OrderBookUpdate!
  trades(marketId: UUID!): Trade!
  tokenEvents(tokenId: UUID!): TokenEvent!
  userUpdates: UserUpdate!
}
```
