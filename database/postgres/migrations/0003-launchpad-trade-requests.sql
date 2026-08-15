CREATE TABLE IF NOT EXISTS launchpad.trade_requests (
  token_id UUID NOT NULL REFERENCES launchpad.tokens(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  client_id TEXT NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 128),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, user_id, client_id)
);

CREATE INDEX IF NOT EXISTS trade_requests_created_at_idx
  ON launchpad.trade_requests (created_at DESC);
