// Package api — JSON HTTP API + (when proto generated) gRPC handlers.
//
// To keep build hermetic, we expose a flat JSON HTTP API that mirrors the
// proto contract.  The proto definitions are kept under /proto for future
// native gRPC clients.
package api

import (
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
	launch *launch.Service
	grad   *graduation.Service
	log    *zap.Logger
}

func NewServer(l *launch.Service, g *graduation.Service, log *zap.Logger) *Server { return &Server{launch: l, grad: g, log: log} }

// Handler returns the HTTP routes mux.  Healthcheck is included.
func (s *Server) Handler() http.Handler {
	r := mux.NewRouter()
	r.HandleFunc("/healthz", s.healthz).Methods("GET")
	r.HandleFunc("/api/v1/tokens", s.listTokens).Methods("GET")
	r.HandleFunc("/api/v1/tokens", s.createToken).Methods("POST")
	r.HandleFunc("/api/v1/tokens/{id}", s.getToken).Methods("GET")
	r.HandleFunc("/api/v1/tokens/{id}/approve", s.approve).Methods("POST")
	r.HandleFunc("/api/v1/tokens/{id}/reject", s.reject).Methods("POST")
	r.HandleFunc("/api/v1/tokens/{id}/pause", s.pause).Methods("POST")
	r.HandleFunc("/api/v1/tokens/{id}/quote-buy", s.quoteBuy).Methods("POST")
	r.HandleFunc("/api/v1/tokens/{id}/buy", s.buy).Methods("POST")
	r.HandleFunc("/api/v1/tokens/{id}/sell", s.sell).Methods("POST")
	return r
}

// RegisterLaunchpadServer / RegisterLaunchpadHandlerFromEndpoint are
// gRPC-server stubs that satisfy the gateway runtime import; we keep them
// as no-ops until native gRPC codegen is added to the build pipeline.
func RegisterLaunchpadServer(_ interface{}, _ *Server)              {}
func RegisterLaunchpadHandlerFromEndpoint(_ interface{}, _ interface{}, _ string, _ []interface{}) error {
	return errors.New("gRPC gateway not enabled in this build (using HTTP/JSON)")
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "launchpad-service", "ts": time.Now().UTC()})
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	tokens, err := s.launch.List(r.Context(), status, limit, offset)
	if err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CreatorID             string              `json:"creator_id"`
		Name                  string              `json:"name"`
		Symbol                string              `json:"symbol"`
		Decimals              int                 `json:"decimals"`
		TotalSupply           string              `json:"total_supply"`
		Chain                 string              `json:"chain"`
		ContractAddress       string              `json:"contract_address"`
		LogoURL               string              `json:"logo_url"`
		BannerURL             string              `json:"banner_url"`
		Description           string              `json:"description"`
		Website               string              `json:"website"`
		Telegram              string              `json:"telegram"`
		Twitter               string              `json:"twitter"`
		Discord               string              `json:"discord"`
		GitHub                string              `json:"github"`
		MintAuthority         string              `json:"mint_authority"`
		FreezeAuthority       string              `json:"freeze_authority"`
		CurveModel            string              `json:"curve_model"`
		CurveParams           json.RawMessage     `json:"curve_params"`
		GraduationRialMinor   int64               `json:"graduation_rial_minor"`
		Vesting               []launch.VestingInput `json:"vesting"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, err); return }
	creator, err := uuid.Parse(body.CreatorID)
	if err != nil { writeErr(w, errors.New("INVALID_CREATOR_ID")); return }
	in := launch.CreateTokenInput{
		Name: body.Name, Symbol: body.Symbol, Decimals: body.Decimals, TotalSupply: body.TotalSupply,
		Chain: body.Chain, ContractAddress: body.ContractAddress,
		LogoURL: body.LogoURL, BannerURL: body.BannerURL, Description: body.Description,
		Website: body.Website, Telegram: body.Telegram, Twitter: body.Twitter, Discord: body.Discord, GitHub: body.GitHub,
		MintAuthority: body.MintAuthority, FreezeAuthority: body.FreezeAuthority,
		CurveModel: body.CurveModel, CurveParams: body.CurveParams,
		GraduationRialMinor: body.GraduationRialMinor, Vesting: body.Vesting,
	}
	t, err := s.launch.Create(r.Context(), creator, in)
	if err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) getToken(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil { writeErr(w, errors.New("INVALID_ID")); return }
	t, err := s.launch.Get(r.Context(), id)
	if err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) approve(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(mux.Vars(r)["id"])
	var body struct{ ActorID string `json:"actor_id"` }
	_ = json.NewDecoder(r.Body).Decode(&body)
	actor, err := uuid.Parse(body.ActorID)
	if err != nil { writeErr(w, errors.New("INVALID_ACTOR_ID")); return }
	if err := s.launch.Approve(r.Context(), actor, id); err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) reject(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(mux.Vars(r)["id"])
	var body struct{ ActorID, Reason string }
	_ = json.NewDecoder(r.Body).Decode(&body)
	actor, err := uuid.Parse(body.ActorID)
	if err != nil { writeErr(w, errors.New("INVALID_ACTOR_ID")); return }
	if err := s.launch.Reject(r.Context(), actor, id, body.Reason); err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) pause(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(mux.Vars(r)["id"])
	var body struct{ ActorID, Reason string }
	_ = json.NewDecoder(r.Body).Decode(&body)
	actor, err := uuid.Parse(body.ActorID)
	if err != nil { writeErr(w, errors.New("INVALID_ACTOR_ID")); return }
	if err := s.launch.Pause(r.Context(), actor, id, body.Reason); err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type quoteReq struct {
	AmountInMinor int64 `json:"amount_in_minor"`
}

func (s *Server) quoteBuy(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(mux.Vars(r)["id"])
	var body quoteReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, err); return }
	q, err := s.launch.QuoteBuy(r.Context(), id, body.AmountInMinor)
	if err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, q)
}

type buyReq struct {
	UserID        string `json:"user_id"`
	AmountInMinor int64  `json:"amount_in_minor"`
	ClientID      string `json:"client_id"`
}

func (s *Server) buy(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(mux.Vars(r)["id"])
	var body buyReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, err); return }
	uid, err := uuid.Parse(body.UserID)
	if err != nil { writeErr(w, errors.New("INVALID_USER_ID")); return }
	res, err := s.launch.Buy(r.Context(), uid, id, body.AmountInMinor, body.ClientID)
	if err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) sell(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(mux.Vars(r)["id"])
	var body struct {
		UserID        string `json:"user_id"`
		AmountInMinor int64  `json:"amount_in_minor"`
		ClientID      string `json:"client_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, err); return }
	uid, err := uuid.Parse(body.UserID)
	if err != nil { writeErr(w, errors.New("INVALID_USER_ID")); return }
	res, err := s.launch.Sell(r.Context(), uid, id, body.AmountInMinor, body.ClientID)
	if err != nil { writeErr(w, err); return }
	writeJSON(w, http.StatusOK, res)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	msg := err.Error()
	if i := strings.IndexAny(msg, " "); i > 0 { msg = msg[:i] } // first word = code
	writeJSON(w, http.StatusBadRequest, map[string]any{"error": msg, "message": err.Error()})
}

var _ = domain.Token{} // keep domain import warm for future gen
