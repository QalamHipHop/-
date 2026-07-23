#!/usr/bin/env bash
# =========================================================================
#  ﷼ Platform — Restore from a backup
#  Usage: BACKUP_FILE=rial-20260723T222254Z.tar.gz.enc bash restore.sh
# =========================================================================
set -euo pipefail

: "${BACKUP_FILE:?Usage: BACKUP_FILE=... bash restore.sh}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"

WORK=/tmp/rial-restore-$$
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

echo "==> Downloading $BACKUP_FILE"
AWS_ACCESS_KEY_ID="${MINIO_ROOT_USER}" \
AWS_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}" \
aws --endpoint-url "${S3_ENDPOINT:-http://minio:9000}" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${BACKUP_PREFIX:-}/$BACKUP_FILE" "$WORK/"

echo "==> Decrypting"
openssl enc -d -aes-256-gcm -pbkdf2 -iter 200000 \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  -in "$WORK/$BACKUP_FILE" -out "$WORK/rial.tar.gz"

echo "==> Extracting"
tar xzf "$WORK/rial.tar.gz" -C "$WORK/"

echo "==> Restoring Postgres"
[[ -f "$WORK/pg.dump" ]] && \
  cat "$WORK/pg.dump" | docker exec -i rial-postgres-1 \
    pg_restore -U "${POSTGRES_USER:-rial}" -d "${POSTGRES_DB:-rial}" --clean --if-exists

echo "==> Restoring MinIO"
[[ -f "$WORK/minio.tar.gz" ]] && \
  docker run --rm -v "$WORK":/backup -v rial_miniodata:/data alpine \
    sh -c "rm -rf /data/* && tar xzf /backup/minio.tar.gz -C /data"

echo "==> Restoring configs"
[[ -f "$WORK/configs.tar.gz" ]] && \
  tar xzf "$WORK/configs.tar.gz" -C /workspace/qalam

echo "Restore complete. Restart services:  make restart"
