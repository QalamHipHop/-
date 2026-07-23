# gRPC Service Catalog (internal)

All services speak gRPC internally over mTLS.

## matching-engine
```
service Matching {
  rpc SubmitOrder(Order) returns (OrderAck);
  rpc CancelOrder(CancelRequest) returns (OrderAck);
  rpc StreamBook(StreamBookRequest) returns (stream BookUpdate);
  rpc StreamTrades(StreamTradesRequest) returns (stream Trade);
}
```

## trading-engine
```
service Trading {
  rpc RouteOrder(Order) returns (RouteResult);
  rpc SmartSplit(SplitRequest) returns (SplitPlan);
  rpc RiskCheck(Order) returns (RiskDecision);
}
```

## wallet-service
```
service Wallet {
  rpc GetAccount(AccountQuery) returns (Account);
  rpc Debit(DebitRequest) returns (LedgerEntry);
  rpc Credit(CreditRequest) returns (LedgerEntry);
  rpc Transfer(TransferRequest) returns (TransferReceipt);
  rpc SignExternal(SignRequest) returns (SignResult);
  rpc ListMultisig(Empty) returns (MultisigList);
}
```

## launchpad-service
```
service Launchpad {
  rpc CreateToken(TokenSpec) returns (Token);
  rpc QuoteBuy(QuoteRequest) returns (Quote);
  rpc QuoteSell(QuoteRequest) returns (Quote);
  rpc ExecuteBuy(TradeRequest) returns (TradeReceipt);
  rpc ExecuteSell(TradeRequest) returns (TradeReceipt);
  rpc Graduate(TokenId) returns (GraduationReceipt);
}
```

## payment-service
```
service Payments {
  rpc ListAdapters(Empty) returns (AdapterList);
  rpc CreateDeposit(DepositRequest) returns (DepositIntent);
  rpc CreateWithdrawal(WithdrawalRequest) returns (WithdrawalIntent);
  rpc GetRate(RateRequest) returns (Rate);
}
```

## ai-engine
```
service AI {
  rpc ScoreUser(UserContext) returns (RiskScore);
  rpc ScoreToken(TokenContext) returns (TokenRisk);
  rpc DetectWashTrade(WashTradeRequest) returns (WashTradeReport);
  rpc ModerateImage(ImageRequest) returns (ModerationResult);
  rpc ModerateText(TextRequest) returns (ModerationResult);
}
```

Proto definitions live in `proto/` and are generated into each service at build time.
