package curve

import (
	"testing"
)

func TestQuoteBuySigmoidMonotonic(t *testing.T) {
	e := NewEngine(nil)
	s := &State{SupplyMinor: 0, ReserveMinor: 0, VirtualMinor: 30_000_000_000, Params: DefaultParams()}
	m := ModelSigmoid
	out, fee, newSup, newRes, err := e.QuoteBuy(s, m, 5_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if fee <= 0 {
		t.Fatalf("fee must be > 0, got %d", fee)
	}
	if out <= 0 {
		t.Fatalf("tokens out must be > 0, got %d", out)
	}
	if newSup <= s.SupplyMinor {
		t.Fatalf("supply must grow")
	}
	if newRes <= s.ReserveMinor {
		t.Fatalf("reserve must grow")
	}
}

func TestQuoteSellFailsOnExcess(t *testing.T) {
	e := NewEngine(nil)
	s := &State{SupplyMinor: 1_000_000, ReserveMinor: 1_000_000, VirtualMinor: 0, Params: DefaultParams()}
	_, _, _, _, err := e.QuoteSell(s, ModelSigmoid, 2_000_000)
	if err == nil {
		t.Fatal("expected insufficient-supply error")
	}
}

func TestValidateUnknownModel(t *testing.T) {
	e := NewEngine(nil)
	if err := e.Validate(Model("weird"), DefaultParams()); err == nil {
		t.Fatal("expected error")
	}
}

func TestSpotPriceRequiresExplicitModelAndReturnsPrice(t *testing.T) {
	state := &State{Params: DefaultParams()}
	for _, model := range []Model{ModelLinear, ModelExponential, ModelLogarithmic, ModelSigmoid} {
		price, err := state.SpotPriceFor(model, 0)
		if err != nil {
			t.Fatalf("model %s returned error: %v", model, err)
		}
		if price <= 0 {
			t.Fatalf("model %s returned non-positive price %v", model, price)
		}
		if _, err := state.PriceMinor8DP(model); err != nil {
			t.Fatalf("model %s current price returned error: %v", model, err)
		}
	}
}

func TestQuoteBuySeparatesFeeFromRedeemableReserve(t *testing.T) {
	engine := NewEngine(nil)
	state := &State{Params: DefaultParams()}
	input := int64(100_000_000)
	out, fee, supply, reserve, err := engine.QuoteBuy(state, ModelLinear, input)
	if err != nil {
		t.Fatalf("quote buy: %v", err)
	}
	if out <= 0 || supply != out || fee <= 0 {
		t.Fatalf("unexpected buy quote out=%d supply=%d fee=%d", out, supply, fee)
	}
	if want := input - fee; reserve != want {
		t.Fatalf("reserve must exclude fee: got %d want %d", reserve, want)
	}
}

func TestQuoteSellRemovesGrossCurveAreaFromReserve(t *testing.T) {
	engine := NewEngine(nil)
	params := DefaultParams()
	initial := &State{Params: params}
	input := int64(100_000_000)
	out, buyFee, boughtSupply, reserve, err := engine.QuoteBuy(initial, ModelLinear, input)
	if err != nil || out <= 0 {
		t.Fatalf("setup buy failed out=%d err=%v", out, err)
	}

	state := &State{SupplyMinor: boughtSupply, ReserveMinor: reserve, Params: params}
	proceeds, sellFee, newSupply, newReserve, err := engine.QuoteSell(state, ModelLinear, boughtSupply)
	if err != nil {
		t.Fatalf("quote sell: %v", err)
	}
	if newSupply != 0 {
		t.Fatalf("expected zero supply after full sell, got %d", newSupply)
	}
	if gross := proceeds + sellFee; reserve-newReserve != gross {
		t.Fatalf("reserve delta must equal gross seller curve area: got %d want %d", reserve-newReserve, gross)
	}
	if buyFee <= 0 || sellFee <= 0 {
		t.Fatalf("fees should be positive buy=%d sell=%d", buyFee, sellFee)
	}
}
