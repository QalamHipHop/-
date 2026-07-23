#!/usr/bin/env bash
# =========================================================================
#  ﷼ Platform — Encrypted backup (Postgres + MinIO + configs)
#  Schedule: BACKUP_SCHEDULE cron
# =========================================================================
set -euo pipefail

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${BACKUP_RETENTION_DAYS:=30}"

TS=$(date -u +"%Y%m%dT%H%M%SZ")
WORK=/tmp/rial-backup-$TS
mkdir -p "$WORK"

trap 'rm -rf "$WORK"' EXIT

echo "==> Dumping Postgres (custom, compressed)"
docker exec rial-postgres-1 pg_dump -U "${POSTGRES_USER:-rial}" -Fc "${POSTGRES_DB:-rial}" > "$WORK/pg.dump"

echo "==> Copying MinIO data (mounted volume snapshot — best-effort)"
docker run --rm -v rial_miniodata:/data:ro -v "$WORK":/backup alpine \
  tar czf /backup/minio.tar.gz -C /data . || true

echo "==> Copying service configs"
tar czf "$WORK/configs.tar.gz" -C /workspace/qalam \
  .env docker-compose.yml infrastructure installer Makefile || true

echo "==> Building encrypted archive"
tar cf - -C "$WORK" . | \
  openssl enc -aes-256-gcm -salt -pbkdf2 -iter 200000 \
    -pass "pass:${BACKUP_ENCRYPTION_KEY}" -out "$WORK/rial-$TS.tar.gz.enc"

echo "==> Uploading to S3"
AWS_ACCESS_KEY_ID="${MINIO_ROOT_USER}" \
AWS_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}" \
aws --endpoint-url "${S3_ENDPOINT:-http://minio:9000}" s3 cp \
  "$WORK/rial-$TS.tar.gz.enc" "s3://${BACKUP_S3_BUCKET}/$TS/"

echo "==> Pruning old backups (>$BACKUP_RETENTION_DAYS days)"
AWS_ACCESS_KEY_ID="${MINIO_ROOT_USER}" \
AWS_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}" \
aws --endpoint-url "${S3_ENDPOINT:-http://minio:9000}" s3 ls "s3://${BACKUP_S3_BUCKET}/" \
  | awk '{print $4}' | while read -r d; do
    [[ -z "$d" ]] && continue
    age=$(( ( $(date +%s) - $(date -d "${d:0:8}" +%s 2>/dev/null || echo 0) ) / 86400 ))
    if (( age > BACKUP_RETENTION_DAYS )); then
      echo "Deleting $d"
      aws --endpoint-url "${S3_ENDPOINT:-http://minio:9000}" s3 rm --recursive "s3://${BACKUP_S3UCKET}/$d" || true
    fi
  done

echo "Backup complete: s3://${BACKUP_S3_BUCKET}/$TS/"
