# Incident Response Runbook

## Triage (first 5 min)

1. Acknowledge the page in PagerDuty/Opsgenie.
2. Open the incident channel `#inc-YYYYMMDD-<slug>`.
3. Declare severity:
   - **SEV-1**: full outage, data loss suspected, security breach.
   - **SEV-2**: major degradation.
   - **SEV-3**: minor / contained.
4. Assign roles: IC, comms, tech lead, scribe.

## Common plays

### Withdrawals spiking abnormally

1. Pause withdrawals: `PATCH /admin/feature-flags/withdrawals_enabled {enabled:false}`.
2. Inspect `wallets.transactions` for outliers.
3. Pull `fraud_score` from `moderation.risk_scores`.
4. Notify legal/compliance if pattern suggests compromise.

### Matching engine falling behind

1. Check `match_latency_ms` p99 in Grafana.
2. Scale up: `kubectl -n rial scale deploy/rial-matching --replicas=+5`.
3. If still degraded, inspect NATS queue depth.
4. Worst case: enable `admin.emergency_pauses` for the affected markets.

### Suspicious token launch

1. Pause: `PATCH /admin/tokens/:id {status:'paused'}`.
2. Freeze: `wallets` admin endpoint → reserve user balances.
3. Engage compliance.

## Postmortem

Within 5 business days:
- Timeline
- Root cause
- Customer impact
- Action items with owners and dates

Save under `docs/postmortems/YYYY-MM-DD-<slug>.md`.
