// Package store wraps PostgreSQL access via pgx.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/rial/launchpad-service/internal/domain"
)

type PG struct {
	Pool *pgxpool.Pool
}

// Domain aliases keep persistence signatures aligned with the public launchpad model.
type Token = domain.Token
type BondingState = domain.BondingState
type Holder = domain.Holder
type VestingSchedule = domain.VestingSchedule

func NewPostgres(ctx context.Context, dsn string, logger *zap.Logger) (*PG, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil { return nil, fmt.Errorf("parse dsn: %w", err) }
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil { return nil, fmt.Errorf("connect: %w", err) }
	if err := pool.Ping(ctx); err != nil { return nil, fmt.Errorf("ping: %w", err) }
	logger.Info("postgres connected", zap.Int32("max_conns", cfg.MaxConns))
	return &PG{Pool: pool}, nil
}

func (p *PG) Close() { p.Pool.Close() }

func (p *PG) WithTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := p.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil { return err }
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil { return err }
	return tx.Commit(ctx)
}

// ---- tokens ----

func (p *PG) CreateToken(ctx context.Context, t *Token) error {
	const q = `INSERT INTO launchpad.tokens
		(id, creator_id, chain, contract_addr, name, symbol, decimals, total_supply,
		 logo_url, banner_url, description, website, telegram, twitter, discord, github,
		 mint_authority, freeze_authority, curve_model, curve_params, graduation_rial_minor, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`
	_, err := p.Pool.Exec(ctx, q,
		t.ID, t.CreatorID, t.Chain, t.ContractAddress, t.Name, t.Symbol, t.Decimals, t.TotalSupply,
		t.LogoURL, t.BannerURL, t.Description, t.Website, t.Telegram, t.Twitter, t.Discord, t.GitHub,
		t.MintAuthority, t.FreezeAuthority, t.CurveModel, t.CurveParams, t.GraduationRialMinor, t.Status,
	)
	return err
}

func (p *PG) GetToken(ctx context.Context, id uuid.UUID) (*Token, error) {
	const q = `SELECT id, creator_id, chain, contract_addr, name, symbol, decimals, total_supply,
		logo_url, banner_url, description, website, telegram, twitter, discord, github,
		mint_authority, freeze_authority, curve_model, curve_params, graduation_rial_minor,
		graduated, graduated_at, status, created_at, updated_at
		FROM launchpad.tokens WHERE id = $1`
	row := p.Pool.QueryRow(ctx, q, id)
	var t Token
	if err := row.Scan(&t.ID, &t.CreatorID, &t.Chain, &t.ContractAddress, &t.Name, &t.Symbol, &t.Decimals, &t.TotalSupply,
		&t.LogoURL, &t.BannerURL, &t.Description, &t.Website, &t.Telegram, &t.Twitter, &t.Discord, &t.GitHub,
		&t.MintAuthority, &t.FreezeAuthority, &t.CurveModel, &t.CurveParams, &t.GraduationRialMinor,
		&t.Graduated, &t.GraduatedAt, &t.Status, &t.CreatedAt, &t.UpdatedAt,
	); err != nil { return nil, err }
	return &t, nil
}

func (p *PG) ListTokens(ctx context.Context, status string, limit, offset int) ([]*Token, error) {
	if limit <= 0 || limit > 200 { limit = 50 }
	if offset < 0 { offset = 0 }
	rows, err := p.Pool.Query(ctx, `SELECT id, creator_id, chain, contract_addr, name, symbol, decimals, total_supply,
		logo_url, banner_url, description, website, telegram, twitter, discord, github,
		mint_authority, freeze_authority, curve_model, curve_params, graduation_rial_minor,
		graduated, graduated_at, status, created_at, updated_at
		FROM launchpad.tokens
		WHERE ($1 = '' OR status = $1)
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, status, limit, offset)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []*Token
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.ID, &t.CreatorID, &t.Chain, &t.ContractAddress, &t.Name, &t.Symbol, &t.Decimals, &t.TotalSupply,
			&t.LogoURL, &t.BannerURL, &t.Description, &t.Website, &t.Telegram, &t.Twitter, &t.Discord, &t.GitHub,
			&t.MintAuthority, &t.FreezeAuthority, &t.CurveModel, &t.CurveParams, &t.GraduationRialMinor,
			&t.Graduated, &t.GraduatedAt, &t.Status, &t.CreatedAt, &t.UpdatedAt,
		); err != nil { return nil, err }
		out = append(out, &t)
	}
	return out, rows.Err()
}

func (p *PG) UpdateTokenStatus(ctx context.Context, id uuid.UUID, status string) error {
	_, err := p.Pool.Exec(ctx, `UPDATE launchpad.tokens SET status=$1, updated_at=now() WHERE id=$2`, status, id)
	return err
}

func (p *PG) MarkGraduated(ctx context.Context, id uuid.UUID) error {
	_, err := p.Pool.Exec(ctx, `UPDATE launchpad.tokens SET graduated=true, graduated_at=now(), status='graduated', updated_at=now() WHERE id=$1`, id)
	return err
}

func (p *PG) CountCreatorTokens(ctx context.Context, creator uuid.UUID) (int, error) {
	var n int
	err := p.Pool.QueryRow(ctx, `SELECT count(*) FROM launchpad.tokens WHERE creator_id=$1 AND status NOT IN ('rejected','draft')`, creator).Scan(&n)
	return n, err
}

// ---- bonding state ----

func (p *PG) GetBonding(ctx context.Context, id uuid.UUID) (*BondingState, error) {
	const q = `SELECT token_id, supply_circulating_minor, reserve_rial_minor, virtual_rial_minor,
		price_rial_per_token_minor_8dp::text, holders_count, updated_at
		FROM launchpad.bonding_state WHERE token_id=$1`
	row := p.Pool.QueryRow(ctx, q, id)
	var b BondingState
	if err := row.Scan(&b.TokenID, &b.SupplyCirculatingMinor, &b.ReserveRialMinor, &b.VirtualRialMinor,
		&b.PriceRialPerTokenMinor8DP, &b.HoldersCount, &b.UpdatedAt,
	); err != nil { return nil, err }
	return &b, nil
}

func (p *PG) UpsertBonding(ctx context.Context, b *BondingState) error {
	const q = `INSERT INTO launchpad.bonding_state
		(token_id, supply_circulating_minor, reserve_rial_minor, virtual_rial_minor, price_rial_per_token_minor_8dp, holders_count, updated_at)
		VALUES ($1,$2,$3,$4,$5::numeric,$6,now())
		ON CONFLICT (token_id) DO UPDATE
		SET supply_circulating_minor=EXCLUDED.supply_circulating_minor,
		    reserve_rial_minor=EXCLUDED.reserve_rial_minor,
		    virtual_rial_minor=EXCLUDED.virtual_rial_minor,
		    price_rial_per_token_minor_8dp=EXCLUDED.price_rial_per_token_minor_8dp,
		    updated_at=now()`
	_, err := p.Pool.Exec(ctx, q, b.TokenID, b.SupplyCirculatingMinor, b.ReserveRialMinor, b.VirtualRialMinor, b.PriceRialPerTokenMinor8DP, b.HoldersCount)
	return err
}

func (p *PG) InitBonding(ctx context.Context, id uuid.UUID, supplyMinor, reserveMinor, virtualMinor int64) error {
	const q = `INSERT INTO launchpad.bonding_state (token_id, supply_circulating_minor, reserve_rial_minor, virtual_rial_minor, price_rial_per_token_minor_8dp, holders_count)
		VALUES ($1,$2,$3,$4,0,0) ON CONFLICT DO NOTHING`
	_, err := p.Pool.Exec(ctx, q, id, supplyMinor, reserveMinor, virtualMinor)
	return err
}

// ---- holders ----

func (p *PG) AddHolderDelta(ctx context.Context, tokenID, userID uuid.UUID, deltaMinor int64) error {
	const q = `INSERT INTO launchpad.holders (token_id, user_id, balance_minor, first_bought_at)
		VALUES ($1,$2,$3, now())
		ON CONFLICT (token_id, user_id) DO UPDATE
		SET balance_minor = launchpad.holders.balance_minor + EXCLUDED.balance_minor`
	_, err := p.Pool.Exec(ctx, q, tokenID, userID, deltaMinor)
	if err != nil { return err }
	_, err = p.Pool.Exec(ctx, `UPDATE launchpad.bonding_state SET holders_count = (SELECT count(*) FROM launchpad.holders WHERE token_id=$1 AND balance_minor > 0) WHERE token_id=$1`, tokenID)
	return err
}

func (p *PG) GetHolder(ctx context.Context, tokenID, userID uuid.UUID) (*Holder, error) {
	const q = `SELECT token_id, user_id, balance_minor, first_bought_at FROM launchpad.holders WHERE token_id=$1 AND user_id=$2`
	row := p.Pool.QueryRow(ctx, q, tokenID, userID)
	var h Holder
	if err := row.Scan(&h.TokenID, &h.UserID, &h.BalanceMinor, &h.FirstBoughtAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) { return nil, nil }
		return nil, err
	}
	return &h, nil
}

// ---- idempotent trade requests ----

func (p *PG) GetTradeRequest(ctx context.Context, tokenID, userID uuid.UUID, clientID string) (*domain.BuyResult, bool, error) {
	var raw []byte
	err := p.Pool.QueryRow(ctx, `SELECT result FROM launchpad.trade_requests WHERE token_id=$1 AND user_id=$2 AND client_id=$3`, tokenID, userID, clientID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) { return nil, false, nil }
	if err != nil { return nil, false, err }
	var result domain.BuyResult
	if err := json.Unmarshal(raw, &result); err != nil { return nil, false, fmt.Errorf("decode trade request: %w", err) }
	return &result, true, nil
}

func (p *PG) CreateTradeRequest(ctx context.Context, tokenID, userID uuid.UUID, clientID string, result *domain.BuyResult) error {
	raw, err := json.Marshal(result)
	if err != nil { return fmt.Errorf("encode trade request: %w", err) }
	_, err = p.Pool.Exec(ctx, `INSERT INTO launchpad.trade_requests (token_id, user_id, client_id, result) VALUES ($1,$2,$3,$4::jsonb)`, tokenID, userID, clientID, raw)
	return err
}

// ---- vesting ----

func (p *PG) CreateVesting(ctx context.Context, v *VestingSchedule) error {
	const q = `INSERT INTO launchpad.vesting_schedules (id, token_id, beneficiary, total_minor, released_minor, cliff_seconds, duration_seconds, start_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := p.Pool.Exec(ctx, q, v.ID, v.TokenID, v.Beneficiary, v.TotalMinor, v.ReleasedMinor, v.CliffSeconds, v.DurationSeconds, v.StartAt)
	return err
}

func (p *PG) ListVestingDue(ctx context.Context, now time.Time) ([]*VestingSchedule, error) {
	rows, err := p.Pool.Query(ctx, `SELECT id, token_id, beneficiary, total_minor, released_minor, cliff_seconds, duration_seconds, start_at, created_at
		FROM launchpad.vesting_schedules
		WHERE released_minor < total_minor
		  AND (start_at + make_interval(secs => cliff_seconds)) <= $1`, now)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []*VestingSchedule
	for rows.Next() {
		var v VestingSchedule
		if err := rows.Scan(&v.ID, &v.TokenID, &v.Beneficiary, &v.TotalMinor, &v.ReleasedMinor, &v.CliffSeconds, &v.DurationSeconds, &v.StartAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &v)
	}
	return out, rows.Err()
}
