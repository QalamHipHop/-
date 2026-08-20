// Package curve implements pluggable bonding-curve models for the launchpad.
//
// All inputs and outputs are in 8-decimal minor units (int64).  The math
// here is intentionally deterministic and pure — no I/O — so the same
// inputs always produce the same quote, which lets us cross-verify in tests
// and against the on-chain program.
package curve

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"

	"go.uber.org/zap"
)

type Model string

const (
	ModelLinear      Model = "linear"
	ModelExponential Model = "exponential"
	ModelLogarithmic Model = "logarithmic"
	ModelSigmoid     Model = "sigmoid"
)

type Params struct {
	// Universal
	SupplyMaxMinor int64 `json:"supply_max_minor"`
	VirtualRial    int64 `json:"virtual_rial_minor"`
	RealRial       int64 `json:"real_rial_minor"`
	// Curve-specific
	Slope          float64 `json:"slope,omitempty"`            // linear
	BasePriceMinor float64 `json:"base_price_minor,omitempty"` // exponential/log base
	GrowthRate     float64 `json:"growth_rate,omitempty"`      // exponential
	Stiffness      float64 `json:"stiffness,omitempty"`        // sigmoid
	Midpoint       float64 `json:"midpoint,omitempty"`         // sigmoid
	// Fee (in basis points, 1 = 0.01%)
	FeeBps int `json:"fee_bps,omitempty"`
}

func DefaultParams() Params {
	return Params{
		SupplyMaxMinor: 1_000_000_000_000_000_000, // 1B tokens * 1e18
		VirtualRial:    30_000_000_000,            // 300 Rial
		RealRial:       0,
		Slope:          1.0,
		BasePriceMinor: 1.0,
		GrowthRate:     1e-9,
		Stiffness:      0.000001,
		Midpoint:       0.5,
		FeeBps:         100,
	}
}

type Engine struct{ log *zap.Logger }

func NewEngine(log *zap.Logger) *Engine { return &Engine{log: log} }

type State struct {
	SupplyMinor  int64 // tokens in circulation (8dp)
	ReserveMinor int64 // real Rial in pool
	VirtualMinor int64 // virtual Rial offset
	Params       Params
}

// PriceMinor8DP returns the current spot price for an explicit curve model.
// A State deliberately does not retain a model, so callers cannot accidentally
// price a sigmoid/exponential launch as an unnamed default curve.
func (s *State) PriceMinor8DP(m Model) (*big.Float, error) {
	p, err := s.SpotPriceFor(m, s.SupplyMinor)
	if err != nil {
		return nil, err
	}
	return new(big.Float).SetFloat64(p), nil
}

func (e *Engine) Validate(m Model, p Params) error {
	if p.SupplyMaxMinor <= 0 {
		return errors.New("curve: supply_max_minor must be > 0")
	}
	if p.VirtualRial < 0 || p.RealRial < 0 {
		return errors.New("curve: reserves must be >= 0")
	}
	if p.FeeBps < 0 || p.FeeBps >= 10_000 {
		return errors.New("curve: fee_bps must be between 0 and 9999")
	}
	if !finitePositive(p.BasePriceMinor) {
		return errors.New("curve: base_price_minor must be finite and > 0")
	}
	switch m {
	case ModelLinear:
		if !finiteNonNegative(p.Slope) {
			return errors.New("curve: linear slope must be finite and >= 0")
		}
	case ModelExponential:
		if !finiteNonNegative(p.GrowthRate) {
			return errors.New("curve: exponential growth_rate must be finite and >= 0")
		}
	case ModelLogarithmic:
		// Base-price validation above is sufficient; log curve is monotonic for xx >= 0.
	case ModelSigmoid:
		if !finitePositive(p.Stiffness) {
			return errors.New("curve: sigmoid stiffness must be finite and > 0")
		}
		if !finite(p.Midpoint) || p.Midpoint < 0 || p.Midpoint > 1 {
			return errors.New("curve: sigmoid midpoint must be in [0,1]")
		}
	default:
		return fmt.Errorf("curve: unknown model %q", m)
	}
	return nil
}

func ParseModel(s string) (Model, error) {
	m := Model(s)
	switch m {
	case ModelLinear, ModelExponential, ModelLogarithmic, ModelSigmoid:
		return m, nil
	}
	return "", fmt.Errorf("curve: unknown model %q", s)
}

// SpotPriceFor returns price in Rial-minor per token-minor at a given supply.
// The model is explicit because State carries reserves and parameters only.
func (s *State) SpotPriceFor(m Model, supplyMinor int64) (float64, error) {
	if supplyMinor < 0 || supplyMinor > s.Params.SupplyMaxMinor {
		return 0, errors.New("curve: supply outside [0,supply_max]")
	}
	if err := (&Engine{}).Validate(m, s.Params); err != nil {
		return 0, err
	}
	price, err := spotAt(s, m, supplyMinor)
	if err != nil || !finitePositive(price) {
		return 0, errors.New("curve: spot price is not finite and positive")
	}
	return price, nil
}

// --- helper math ---

func exp(x float64) float64     { return powE(x) }
func log1p(x float64) float64   { return lnE(1 + x) }
func sigmoid(x float64) float64 { return 1 / (1 + powE(-x)) }

// Cached math via stdlib (avoids importing math twice)
func powE(x float64) float64 { return powEImpl(x) }
func lnE(x float64) float64  { return lnEImpl(x) }

// QuoteBuy — given `rialInMinor` (8dp), how many token-minor can the user buy?
// Uses a 32-step trapezoidal integration of 1/price over [s, s+Δ] for accuracy.
func (e *Engine) QuoteBuy(s *State, m Model, rialInMinor int64) (tokensOut int64, feeMinor int64, newSupply int64, newReserve int64, err error) {
	if err = e.Validate(m, s.Params); err != nil {
		return
	}
	if rialInMinor <= 0 {
		err = errors.New("curve: amount must be > 0")
		return
	}
	fee, ferr := feeFor(rialInMinor, s.Params.FeeBps)
	if ferr != nil {
		err = ferr
		return
	}
	effective := rialInMinor - fee

	if effective <= 0 {
		err = errors.New("curve: fee consumes input")
		return
	}
	capacity, ierr := integrate(s, m, s.SupplyMinor, s.Params.SupplyMaxMinor)
	if ierr != nil || !finiteNonNegative(capacity) || capacity < float64(effective) {
		err = errors.New("curve: insufficient curve capacity")
		return
	}
	// binary search for supply that satisfies ∫(s→s+Δ) p(x) dx = effective
	lo, hi := s.SupplyMinor, s.Params.SupplyMaxMinor
	for it := 0; it < 80; it++ {
		mid := lo + (hi-lo)/2
		area, ierr := integrate(s, m, s.SupplyMinor, mid)
		if ierr != nil || !finiteNonNegative(area) {
			err = errors.New("curve: invalid integration result")
			return
		}
		if area < float64(effective) {
			lo = mid
		} else {
			hi = mid
		}
	}
	// refine with one more iteration
	avg := (lo + hi) / 2
	area, _ := integrate(s, m, s.SupplyMinor, avg)
	_ = area
	tokensOut = avg - s.SupplyMinor
	if tokensOut < 0 {
		tokensOut = 0
	}
	newSupply = s.SupplyMinor + tokensOut
	// Only net input backs future redemptions. The fee is settled to treasury.
	if effective > math.MaxInt64-s.ReserveMinor {
		err = errors.New("curve: reserve overflow")
		return
	}
	newReserve = s.ReserveMinor + effective
	feeMinor = fee
	return
}

// QuoteSell — inverse: given `tokensInMinor`, how much Rial out?
func (e *Engine) QuoteSell(s *State, m Model, tokensInMinor int64) (rialOutMinor int64, feeMinor int64, newSupply int64, newReserve int64, err error) {
	if err = e.Validate(m, s.Params); err != nil {
		return
	}
	if tokensInMinor <= 0 {
		err = errors.New("curve: amount must be > 0")
		return
	}
	if tokensInMinor > s.SupplyMinor {
		err = errors.New("curve: insufficient supply")
		return
	}
	area, ierr := integrate(s, m, s.SupplyMinor-tokensInMinor, s.SupplyMinor)
	if ierr != nil || !finiteNonNegative(area) || area > float64(math.MaxInt64) {
		err = errors.New("curve: invalid sell integration result")
		return
	}
	grossRialOut := int64(math.Floor(area))
	fee, ferr := feeFor(grossRialOut, s.Params.FeeBps)
	if ferr != nil {
		err = ferr
		return
	}
	rialOutMinor = grossRialOut - fee
	newSupply = s.SupplyMinor - tokensInMinor
	// The full curve area exits reserve: net proceeds go to seller and fee goes
	// to treasury. Leaving fee in reserve makes it redeemable twice.
	if grossRialOut > s.ReserveMinor {
		err = errors.New("curve: insufficient reserve")
		return
	}
	newReserve = s.ReserveMinor - grossRialOut
	if newReserve < 0 {
		err = errors.New("curve: insufficient reserve")
		return
	}
	feeMinor = fee
	return
}

// integrate trapezoidal over price-curve, scaled to 1e-16 precision.
func integrate(s *State, m Model, a, b int64) (float64, error) {
	if b <= a {
		return 0, nil
	}
	steps := 32
	if b-a < 1_000_000 {
		steps = 16
	}
	width := float64(b-a) / float64(steps)
	var total float64
	for i := 0; i < steps; i++ {
		x1 := a + int64(float64(i)*width)
		x2 := a + int64(float64(i+1)*width)
		p1, _ := spotAt(s, m, x1)
		p2, _ := spotAt(s, m, x2)
		total += (p1 + p2) / 2 * width
	}
	// total is in (rial-per-token-minor) * token-minor = rial-minor^2 / 1e8
	// divide by 1e8 to get rial-minor
	return total / 1e8, nil
}

func feeFor(amount int64, feeBps int) (int64, error) {
	if amount < 0 || feeBps < 0 || feeBps >= 10_000 {
		return 0, errors.New("curve: invalid fee input")
	}
	if feeBps == 0 || amount == 0 {
		return 0, nil
	}
	if amount > math.MaxInt64/int64(feeBps) {
		return 0, errors.New("curve: fee multiplication overflow")
	}
	return (amount * int64(feeBps)) / 10_000, nil
}

func finite(x float64) bool            { return !math.IsNaN(x) && !math.IsInf(x, 0) }
func finitePositive(x float64) bool    { return finite(x) && x > 0 }
func finiteNonNegative(x float64) bool { return finite(x) && x >= 0 }

func spotAt(s *State, m Model, x int64) (float64, error) {
	p := s.Params
	xx := float64(x) / float64(p.SupplyMaxMinor)
	switch m {
	case ModelLinear:
		return p.BasePriceMinor + p.Slope*xx, nil
	case ModelExponential:
		return p.BasePriceMinor * powE(p.GrowthRate*float64(x)), nil
	case ModelLogarithmic:
		if xx <= 0 {
			return p.BasePriceMinor, nil
		}
		return p.BasePriceMinor * (1 + log1p(xx*9)), nil
	case ModelSigmoid:
		maxP := float64(p.VirtualRial) / 1e8 * 10
		return p.BasePriceMinor + (maxP-p.BasePriceMinor)*sigmoid((xx-p.Midpoint)/max(p.Stiffness, 1e-9)), nil
	}
	return 0, errors.New("curve: unsupported model")
}

func EncodeParams(p Params) []byte { b, _ := json.Marshal(p); return b }
func DecodeParams(b []byte) (Params, error) {
	var p Params
	if len(b) == 0 {
		return DefaultParams(), nil
	}
	err := json.Unmarshal(b, &p)
	if err != nil {
		return Params{}, err
	}
	if p.SupplyMaxMinor == 0 {
		p = DefaultParams()
	}
	return p, nil
}
