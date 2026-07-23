# Disaster Recovery Plan

## Scope
This document covers platform-wide incidents: data loss, regional outage, security breach, third-party failure.

## Severity levels

| Sev   | Description                              | Response time | Decision authority |
|-------|------------------------------------------|---------------|--------------------|
| SEV-1 | Full outage / data loss suspected        | ≤ 15 min      | Incident commander |
| SEV-2 | Major degradation or single-region issue | ≤ 30 min      | On-call lead       |
| SEV-3 | Minor / contained                        | ≤ 4 h         | Service owner      |

## Scenarios

### A) Database corruption / accidental drop

1. Stop writes: `make pause` (sets `admin.emergency_pauses.enabled=true`).
2. Identify the most recent good backup: `aws s3 ls s3://rial-backups/`.
3. Restore to a **staging namespace** first, run smoke tests.
4. Promote to primary once verified.
5. Post-incident review within 5 business days.

### B) Region down (us-east-1 unreachable)

1. DNS failover to secondary region via Route53 health check.
2. Secondary region has a hot-standby cluster (async replica + warm Redis).
3. ClickHouse and Kafka replicate cross-region.
4. Once primary recovers, replay audit log to reconcile any writes that happened in the secondary.

### C) Security breach (key leak, vuln, intrusion)

1. Rotate **all** affected secrets via Vault; revoke sessions; pause withdrawals.
2. Snapshot forensic state.
3. Engage legal/compliance; user notification per jurisdiction.
4. Post-mortem and CVE disclosure if applicable.

## Roles

- **Incident Commander** — declares severity, owns decisions, runs comms.
- **Comms Lead** — internal + external messaging.
- **Tech Lead** — coordinates engineering response.
- **Scribe** — logs timeline in #incident channel.

## Communication

- Internal: dedicated channel, hourly updates minimum.
- External: status page (Statuspage or self-hosted).
- Regulatory: per jurisdiction (FSA, FinCEN, etc.).

## Rehearsal

- Quarterly **game day** simulating each scenario.
- Annual third-party DR review.

## Data integrity guarantee

The hash-chained audit log (ADR-0008) allows us to verify, after a restore, that no event was tampered with during the outage. The `audit-checker` cron emits an alert if it ever fails verification.
