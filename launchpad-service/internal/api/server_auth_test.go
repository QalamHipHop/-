package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInternalAuthRequiresTokenAndServiceScope(t *testing.T) {
	s := &Server{internalToken: "launchpad-secret", internalService: "backend"}
	handler := s.internalAuth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	tests := []struct {
		name    string
		token   string
		service string
		want    int
	}{
		{name: "valid", token: "launchpad-secret", service: "backend", want: http.StatusNoContent},
		{name: "missing scope", token: "launchpad-secret", want: http.StatusUnauthorized},
		{name: "wrong scope", token: "launchpad-secret", service: "launchpad", want: http.StatusUnauthorized},
		{name: "wrong token", token: "wrong", service: "backend", want: http.StatusUnauthorized},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/tokens", nil)
			if tc.token != "" {
				req.Header.Set("X-Rial-Internal-Token", tc.token)
			}
			if tc.service != "" {
				req.Header.Set("X-Rial-Service", tc.service)
			}
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != tc.want {
				t.Fatalf("status = %d, want %d", res.Code, tc.want)
			}
		})
	}
}
