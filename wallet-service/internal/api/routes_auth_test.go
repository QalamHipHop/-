package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/rial/wallet-service/internal/config"
)

func testAuthRouter(cfg *config.Config) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(internalAuth(cfg))
	r.GET("/protected", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	return r
}

func TestInternalAuthProductionRequiresServiceScope(t *testing.T) {
	cfg := &config.Config{
		Env:           "production",
		InternalToken: "legacy-token-that-must-not-be-used",
		ServiceTokens: map[string]string{"backend": "backend-secret"},
	}

	tests := []struct {
		name    string
		service string
		token   string
		status  int
	}{
		{name: "missing scope", token: "backend-secret", status: http.StatusUnauthorized},
		{name: "unknown scope", service: "admin", token: "backend-secret", status: http.StatusUnauthorized},
		{name: "wrong scoped token", service: "backend", token: "legacy-token-that-must-not-be-used", status: http.StatusUnauthorized},
		{name: "valid scoped token", service: "backend", token: "backend-secret", status: http.StatusNoContent},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/protected", nil)
			if tt.service != "" {
				req.Header.Set("X-Rial-Service", tt.service)
			}
			req.Header.Set("X-Rial-Internal-Token", tt.token)
			rec := httptest.NewRecorder()
			testAuthRouter(cfg).ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d", rec.Code, tt.status)
			}
		})
	}
}

func TestInternalAuthDevelopmentAllowsLegacyFallback(t *testing.T) {
	cfg := &config.Config{Env: "development", InternalToken: "legacy-token"}
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("X-Rial-Internal-Token", "legacy-token")
	rec := httptest.NewRecorder()
	testAuthRouter(cfg).ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}
