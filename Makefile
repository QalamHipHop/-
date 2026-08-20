# =====================================================================
#  ﷼ Platform — Makefile
#  Common operations. Run `make help` for a list of targets.
# =====================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help
COMPOSE := docker compose
PROJECT := rial

# Allow override of env file
ifneq (,$(wildcard .env))
include .env
export
endif

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ----- install / setup ------------------------------------------------

install: ## One-command install (interactive wizard)
	@bash installer/install.sh

wizard: ## Run the configuration wizard only
	@bash installer/wizard.sh

# ----- lifecycle -----------------------------------------------------

bootstrap: ## Create env, start infrastructure, migrate, seed, and build services
	@bash scripts/bootstrap.sh

up: ## Start the full dev stack
	$(COMPOSE) --env-file .env -f docker-compose.yml up -d
	@echo "Stack up. UI: http://localhost:3000  API: http://localhost:8080"

down: ## Stop the stack
	$(COMPOSE) -f docker-compose.yml down

restart: ## Restart the stack
	$(COMPOSE) -f docker-compose.yml restart

ps: ## Show running services
	$(COMPOSE) -f docker-compose.yml ps

logs: ## Tail logs (all)
	$(COMPOSE) -f docker-compose.yml logs -f --tail=200

logs-%: ## Tail logs for a specific service (e.g. make logs-backend)
	$(COMPOSE) -f docker-compose.yml logs -f --tail=200 $*

# ----- build --------------------------------------------------------

build: ## Build all service images
	$(COMPOSE) -f docker-compose.yml build

build-%: ## Build one service
	$(COMPOSE) -f docker-compose.yml build $*

# ----- per-service dev -----------------------------------------------

dev-%: ## Run a single service in dev mode (e.g. make dev-backend)
	@bash scripts/dev.sh $*

# ----- database ------------------------------------------------------

db-migrate: ## Run database migrations
	$(COMPOSE) -f docker-compose.yml run --rm migrate

db-seed: ## Seed dev data
	$(COMPOSE) -f docker-compose.yml run --rm seed

db-shell: ## Open psql
	$(COMPOSE) -f docker-compose.yml exec postgres psql -U $(POSTGRES_USER) $(POSTGRES_DB)

redis-cli: ## Open redis-cli
	$(COMPOSE) -f docker-compose.yml exec redis redis-cli

# ----- verification / tests ------------------------------------------

doctor: ## Verify required local tools and configuration
	@command -v docker >/dev/null || { echo 'Docker is required. Install Docker Engine or Docker Desktop first.'; exit 1; }
	@docker compose version >/dev/null || { echo 'Docker Compose v2 is required.'; exit 1; }
	@test -f .env || { echo 'Missing .env. Run: cp .env.example .env'; exit 1; }
	@$(COMPOSE) --env-file .env config >/dev/null || { echo 'docker-compose.yml is invalid or has unresolved configuration.'; exit 1; }
	@echo 'Environment checks passed.'

verify: ## Run typecheck, tests, and frontend production build
	pnpm -r typecheck
	pnpm -r test
	pnpm --filter @rial/frontend build

# ----- tests --------------------------------------------------------

test: ## Run all tests
	$(COMPOSE) -f docker-compose.yml run --rm test

test-unit: ## Unit tests
	$(COMPOSE) -f docker-compose.yml run --rm test unit

test-int: ## Integration tests
	$(COMPOSE) -f docker-compose.yml run --rm test integration

test-e2e: ## E2E tests
	$(COMPOSE) -f docker-compose.yml run --rm test e2e

staging-smoke: ## Check staging health/readiness/metrics endpoints
	@bash scripts/staging-smoke.sh

release-load-smoke: ## Run read-only latency/error-rate smoke test
	@bash scripts/release-load-smoke.sh

fault-injection: ## Run a guarded staging fault-injection scenario
	@bash scripts/fault-injection.sh

lint: ## Lint all
	$(COMPOSE) -f docker-compose.yml run --rm lint

# ----- backups -------------------------------------------------------

backup: ## Run a manual encrypted backup
	@bash infrastructure/backup/backup.sh

restore: ## Restore from a backup (BACKUP_FILE=..., CONFIRM_RESTORE=YES)
	@test -n "$(BACKUP_FILE)" || (echo 'Usage: make restore BACKUP_FILE=timestamp/rial-*.tar.gz.gpg CONFIRM_RESTORE=YES' >&2; exit 1)
	@BACKUP_FILE="$(BACKUP_FILE)" bash infrastructure/backup/restore.sh

# ----- updates -------------------------------------------------------

update: ## Pull & rebuild the stack
	@bash scripts/update.sh

# ----- clean ---------------------------------------------------------

clean: ## Stop and remove containers, networks
	$(COMPOSE) -f docker-compose.yml down --remove-orphans

nuke: ## ⚠️  Remove containers, volumes, images (DESTRUCTIVE)
	$(COMPOSE) -f docker-compose.yml down -v --remove-orphans --rmi all

# ----- observability -------------------------------------------------

grafana: ## Open Grafana URL
	@echo http://localhost:3002

prom: ## Open Prometheus URL
	@echo http://localhost:9090

kibana: ## Open Kibana URL
	@echo http://localhost:5601

# ----- kubernetes ----------------------------------------------------

kube-install: ## Install with Helm
	helm upgrade --install rial infrastructure/kubernetes/helm \
		--namespace rial --create-namespace \
		-f infrastructure/kubernetes/helm/values.yaml

kube-uninstall: ## Uninstall from cluster
	helm uninstall rial -n rial
