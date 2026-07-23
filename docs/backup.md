# Backup Strategy

## What is backed up

| Component       | Method                                  | Frequency | Retention |
|-----------------|-----------------------------------------|-----------|-----------|
| PostgreSQL      | `pg_dump -Fc` + WAL streaming           | every 6h  | 30 days   |
| ClickHouse      | native `BACKUP` to S3                   | daily     | 30 days   |
| MinIO (objects) | tarball snapshot of volume              | daily     | 30 days   |
| Configs         | tarball of repo + .env                  | every 6h  | 30 days   |
| Audit log       | Kafka tiered storage                    | n/a       | 7 years   |

## Encryption

- Backups are encrypted with **AES-256-GCM** using PBKDF2-derived keys.
- Keys live in HashiCorp Vault; `BACKUP_ENCRYPTION_KEY` env var holds the active version.
- S3 buckets have object-lock + bucket policy denying deletes.

## RPO / RTO targets

- **RPO ≤ 5 min** (WAL streaming to S3 + 6h full snapshot).
- **RTO ≤ 30 min** (automated restore runbook, rehearse quarterly).

## Verification

- Daily `restore-test` job: pulls the most recent backup, restores to an isolated namespace, runs smoke tests, and reports to a Slack channel.
- Failure alerts via Prometheus.

## Restore

```bash
# List available backups
aws --endpoint-url $S3 s3 ls s3://rial-backups/

# Restore a specific backup
BACKUP_FILE=rial-20260723T222254Z.tar.gz.enc \
BACKUP_ENCRYPTION_KEY=$KEY \
  bash infrastructure/backup/restore.sh
```

See [`disaster-recovery.md`](disaster-recovery.md) for full regional failover.
