#!/usr/bin/env bash
# RIAL Platform — guarded restore from an encrypted backup.
# Required: BACKUP_FILE, BACKUP_ENCRYPTION_KEY, BACKUP_S3_BUCKET, MINIO credentials.
# Destructive restore requires CONFIRM_RESTORE=YES.
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${TMPDIR:-/tmp}/rial-restore-$$"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-rial-postgres-1}"
MINIO_VOLUME="${MINIO_VOLUME:-rial_miniodata}"
CONFIG_ROOT="${CONFIG_ROOT:-$ROOT_DIR}"
S3_ENDPOINT="${S3_ENDPOINT:-http://minio:9000}"
RESTORE_CONFIGS="${RESTORE_CONFIGS:-0}"

: "${BACKUP_FILE:?Usage: BACKUP_FILE=timestamp/rial-*.tar.gz.gpg bash restore.sh}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
[[ "${CONFIRM_RESTORE:-}" == "YES" ]] || { echo 'Destructive restore blocked. Set CONFIRM_RESTORE=YES after verifying the backup.' >&2; exit 1; }

for command in docker aws gpg sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing command: $command" >&2; exit 1; }
done
umask 077
mkdir -p "$WORK"
printf '%s' "$BACKUP_ENCRYPTION_KEY" > "$WORK/.backup-passphrase"
chmod 600 "$WORK/.backup-passphrase"
trap 'rm -rf "$WORK"' EXIT

ENCRYPTED="$WORK/$(basename "$BACKUP_FILE")"
AWS_ACCESS_KEY_ID="$MINIO_ROOT_USER" AWS_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
  aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://${BACKUP_S3_BUCKET}/${BACKUP_FILE}" "$ENCRYPTED"

case "$ENCRYPTED" in
  *.gpg) ;;
  *) echo "Unsupported backup format; expected .gpg" >&2; exit 1 ;;
esac

echo '==> Decrypting'
ARCHIVE="$WORK/rial-restore.tar.gz"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$WORK/.backup-passphrase" \
  --output "$ARCHIVE" --decrypt "$ENCRYPTED"

echo '==> Extracting and verifying manifest'
tar xzf "$ARCHIVE" -C "$WORK"
[[ -f "$WORK/MANIFEST.sha256" ]] || { echo 'backup manifest is missing' >&2; exit 1; }
( cd "$WORK" && sha256sum -c MANIFEST.sha256 )

[[ -f "$WORK/pg.dump" ]] || { echo 'pg.dump is missing' >&2; exit 1; }
echo '==> Restoring Postgres (destructive)'
cat "$WORK/pg.dump" | docker exec -i "$POSTGRES_CONTAINER" \
  pg_restore -U "${POSTGRES_USER:-rial}" -d "${POSTGRES_DB:-rial}" \
  --clean --if-exists --exit-on-error

if [[ -f "$WORK/minio.tar.gz" ]]; then
  echo '==> Restoring MinIO volume (destructive)'
  docker run --rm -v "$WORK:/backup:ro" -v "${MINIO_VOLUME}:/data" alpine \
    sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /backup/minio.tar.gz -C /data'
fi

if [[ "$RESTORE_CONFIGS" == "1" && -f "$WORK/configs.tar.gz" ]]; then
  echo '==> Restoring deployment configs by explicit request'
  mkdir -p "$CONFIG_ROOT"
  tar xzf "$WORK/configs.tar.gz" -C "$CONFIG_ROOT"
else
  echo '==> Keeping current deployment configs (set RESTORE_CONFIGS=1 to replace them)'
fi

echo 'Restore complete. Run migrations/health checks and restart services only after verifying the restored ledger.'
