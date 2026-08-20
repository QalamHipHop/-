// Package api — JSON HTTP API + (when proto generated) gRPC handlers.
//
// To keep build hermetic, we expose a flat JSON HTTP API that mirrors the
// proto contract.  The proto definitions are kept under /proto for future
// native gRPC clients.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"go.uber.org/zap"

	"github.com/rial/launchpad-service/internal/domain"
	"github.com/rial/launchpad-service/internal/graduation"
	"github.com/rial/launchpad-service/internal/launch"
)

type Server struct {
	UnimplementedLaunchpadServer
	launch        *launch.Service
	grad          *graduation.Service
	log           *zap.Logger
	internalToken string
}

// NewServer accepts mutations only from a platform caller that has already
// authenticated the end user and forwards the verified identity headers.
func NewServer(l *launch.Service, g *graduation.Service, log *zap.Logger, internalToken string) *Server {
	return &Server{launch: l, grad: g, log: log, internalToken: internalToken}
}

// Handler returns the HTTP routes mux.  Healthcheck is included.
func (s *Server) Handler() http.Handler {
	r := mux.NewRouter()
	r.HandleFunc("/healthz", s.healthz).Methods("GET")
	r.HandleFunc("/metrics", s.metrics).Methods("GET")
	r.HandleFunc("/api/v1/tokens", s.listTokens).Methods("GET")
	r.HandleFunc("/api/v1/tokens/{id}", s.getToken).Methods("GET")

	// Public consumers may read listed token data. Every state-changing path,
	// and quote generation used before settlement, requires a trusted caller.
	internal := r.NewRoute().Subrouter()
	internal.Use(s.internalAuth)
	internal.HandleFunc("/api/v1/tokens", s.createToken).Methods("POST")
	internal.HandleFunc("/api/v1/tokens/{id}/approve", s.approve).Methods("POST")
	internal.HandleFunc("/api/v1/tokens/{id}/reject", s.reject).Methods("POST")
	internal.HandleFunc("/api/v1/tokens/{id}/pause", s.pause).Methods("POST")
	internal.HandleFunc("/api/v1/tokens/{id}/quote-buy", s.quoteBuy).Methods("POST")
	internal.HandleFunc("/api/v1/tokens/{id}/buy", s.buy).Methods("POST")
	internal.HandleFunc("/api/v1/tokens/{id}/sell", s.sell).Methods("POST")
	return r
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "launchpad-service", "ts": time.Now().UTC()})
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	tokens, err := s.launch.List(r.Context(), status, limit, offset)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name                string                `json:"name"`
		Symbol              string                `json:"symbol"`
		Decimals            int                   `json:"decimals"`
		TotalSupply         string                `json:"total_supply"`
		Chain               string                `json:"chain"`
		ContractAddress     string                `json:"contract_address"`
		LogoURL             string                `json:"logo_url"`
		BannerURL           string                `json:"banner_url"`
		Description         string                `json:"description"`
		Website             string                `json:"website"`
		Telegram            string                `json:"telegram"`
		Twitter             string                `json:"twitter"`
		Discord             string                `json:"discord"`
		GitHub              string                `json:"github"`
		MintAuthority       string                `json:"mint_authority"`
		FreezeAuthority     string                `json:"freeze_authority"`
		CurveModel          string                `json:"curve_model"`
		CurveParams         json.RawMessage       `json:"curve_params"`
		GraduationRialMinor string                `json:"graduation_rial_minor"`
		Vesting             []launch.VestingInput `json:"vesting"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, err)
		return
	}
	graduationRialMinor, err := parseInt64(body.GraduationRialMinor)
	if err != nil {
		writeErr(w, errors.New("INVALID_GRADUATION_RIAL_MINOR"))
		return
	}
	creator, err := s.authenticatedUserID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	in := launch.CreateTokenInput{
		Name: body.Name, Symbol: body.Symbol, Decimals: body.Decimals, TotalSupply: body.TotalSupply,
		Chain: body.Chain, ContractAddress: body.ContractAddress,
		LogoURL: body.LogoURL, BannerURL: body.BannerURL, Description: body.Description,
		Website: body.Website, Telegram: body.Telegram, Twitter: body.Twitter, Discord: body.Discord, GitHub: body.GitHub,
		MintAuthority: body.MintAuthority, FreezeAuthority: body.FreezeAuthority,
		CurveModel: body.CurveModel, CurveParams: body.CurveParams,
		GraduationRialMinor: graduationRialMinor, Vesting: body.Vesting,
	}
	t, err := s.launch.Create(r.Context(), creator, in)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) getToken(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		writeErr(w, errors.New("INVALID_ID"))
		return
	}
	t, err := s.launch.Get(r.Context(), id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) approve(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		writeErr(w, errors.New("INVALID_ID"))
		return
	}
	actor, err := s.requireAdmin(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.launch.Approve(r.Context(), actor, id); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) reject(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		writeErr(w, errors.New("INVALID_ID"))
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, err)
		return
	}
	actor, err := s.requireAdmin(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.launch.Reject(r.Context(), actor, id, body.Reason); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) pause(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		writeErr(w, errors.New("INVALID_ID"))
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, err)
		return
	}
	actor, err := s.requireAdmin(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.launch.Pause(r.Context(), actor, id, body.Reason); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type quoteReq struct {
	AmountInMinor string `json:"amount_in_minor"`
}

func (s *Server) quoteBuy(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		writeErr(w, errors.New("INVALID_ID"))
		return
	}
	var body quoteReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, err)
		return
	}
	amountInMinor, err := parseInt64(body.AmountInMinor)
	if err != nil {
		writeErr(w, errors.New("INVALID_AMOUNT_IN_MINOR"))
		return
	}
	q, err := s.launch.QuoteBuy(r.Context(), id, amountInMinor)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, q)
}

type buyReq struct {
	AmountInMinor string `json:"amount_in_minor"`
	ClientID      string `json:"client_id"`
}

func (s *Server) buy(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		writeErr(w, errors.New("INVALID_ID"))
		return
	}
	var body buyReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, err)
		return
	}
	uid, err := s.authenticatedUserID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	amountInMinor, err := parseInt64(body.AmountInMinor)
	if err != nil {
		writeErr(w, errors.New("INVALID_AMOUNT_IN_MINOR"))
		return
	}
	res, err := s.launch.Buy(r.Context(), uid, id, amountInMinor, body.ClientID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) sell(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		writeErr(w, errors.New("INVALID_ID"))
		return
	}
	var body struct {
		AmountInMinor string `json:"amount_in_minor"`
		ClientID      string `json:"client_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, err)
		return
	}
	uid, err := s.authenticatedUserID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	amountInMinor, err := parseInt64(body.AmountInMinor)
	if err != nil {
		writeErr(w, errors.New("INVALID_AMOUNT_IN_MINOR"))
		return
	}
	res, err := s.launch.Sell(r.Context(), uid, id, amountInMinor, body.ClientID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- authentication helpers ----

func (s *Server) internalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := r.Header.Get("X-Rial-Internal-Token")
		if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(s.internalToken)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "internal_auth_required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authenticatedUserID(r *http.Request) (uuid.UUID, error) {
	userID, err := uuid.Parse(r.Header.Get("X-Rial-User-ID"))
	if err != nil {
		return uuid.Nil, errors.New("AUTHENTICATED_USER_REQUIRED")
	}
	return userID, nil
}

func (s *Server) requireAdmin(r *http.Request) (uuid.UUID, error) {
	for _, role := range strings.Split(r.Header.Get("X-Rial-Actor-Roles"), ",") {
		if strings.EqualFold(strings.TrimSpace(role), "admin") {
			return s.authenticatedUserID(r)
		}
	}
	return uuid.Nil, errors.New("FORBIDDEN_ROLE")
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	msg := err.Error()
	if i := strings.IndexAny(msg, " "); i > 0 { // first word = code
		msg = msg[:i]
	}
	status := http.StatusBadRequest
	switch msg {
	case "AUTHENTICATED_USER_REQUIRED":
		status = http.StatusUnauthorized
	case "FORBIDDEN_ROLE":
		status = http.StatusForbidden
	}
	writeJSON(w, status, map[string]any{"error": msg, "message": err.Error()})
}

var _ = domain.Token{} // keep domain import warm for future gen
