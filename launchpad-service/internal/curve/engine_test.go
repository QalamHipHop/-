package curve

import (
	"testing"
)

func TestQuoteBuySigmoidMonotonic(t *testing.T) {
	e := NewEngine(nil)
	s := &State{SupplyMinor: 0, ReserveMinor: 0, VirtualMinor: 30_000_000_000, Params: DefaultParams()}
	m := ModelSigmoid
	out, fee, newSup, newRes, err := e.QuoteBuy(s, m, 5_000_000_000)
	if err != nil { t.Fatal(err) }
	if fee <= 0 { t.Fatalf("fee must be > 0, got %d", fee) }
	if out <= 0 { t.Fatalf("tokens out must be > 0, got %d", out) }
	if newSup <= s.SupplyMinor { t.Fatalf("supply must grow") }
	if newRes <= s.ReserveMinor { t.Fatalf("reserve must grow") }
}

func TestQuoteSellFailsOnExcess(t *testing.T) {
	e := NewEngine(nil)
	s := &State{SupplyMinor: 1_000_000, ReserveMinor: 1_000_000, VirtualMinor: 0, Params: DefaultParams()}
	_, _, _, _, err := e.QuoteSell(s, ModelSigmoid, 2_000_000)
	if err == nil { t.Fatal("expected insufficient-supply error") }
}

func TestValidateUnknownModel(t *testing.T) {
	e := NewEngine(nil)
	if err := e.Validate(Model("weird"), DefaultParams()); err == nil {
		t.Fatal("expected error")
	}
}
