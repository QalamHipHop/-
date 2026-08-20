package graduation

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestHTTPAdapterFailsClosedWithoutEndpoint(t *testing.T) {
	adapter := NewHTTPAdapter("", "")
	_, err := adapter.CreatePool(context.Background(), PoolRequest{TokenID: uuid.New(), Base: "RIAL", ReserveRialMinor: 1, SupplyMinor: 1, IdempotencyKey: "graduation:test"})
	if err == nil || err.Error() != "AMM_ENDPOINT_UNCONFIGURED" {
		t.Fatalf("expected fail-closed endpoint error, got %v", err)
	}
}
