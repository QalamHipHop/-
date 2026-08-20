#!/usr/bin/env bash
# RIAL Platform — encrypted, checksummed backup.
# Required: BACKUP_S3_BUCKET, BACKUP_ENCRYPTION_KEY, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD.
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TS="$(date -u +"%Y%m%dT%H%M%SZ")"
WORK="${TMPDIR:-/tmp}/rial-backup-${TS}-$$"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-rial-postgres-1}"
MINIO_VOLUME="${MINIO_VOLUME:-rial_miniodata}"
CONFIG_ROOT="${CONFIG_ROOT:-$ROOT_DIR}"
S3_ENDPOINT="${S3_ENDPOINT:-http://minio:9000}"

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"

for command in docker aws gpg sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing command: $command" >&2; exit 1; }
done
umask 077
mkdir -p "$WORK"
printf '%s' "$BACKUP_ENCRYPTION_KEY" > "$WORK/.backup-passphrase"
chmod 600 "$WORK/.backup-passphrase"
trap 'rm -rf "$WORK"' EXIT

cleanup_optional_files=()
echo "==> Dumping Postgres"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "${POSTGRES_USER:-rial}" -Fc "${POSTGRES_DB:-rial}" > "$WORK/pg.dump"

if [[ "${BACKUP_SKIP_MINIO:-0}" == "1" ]]; then
  echo "==> Skipping MinIO only by explicit BACKUP_SKIP_MINIO=1"
else
  echo "==> Archiving MinIO volume"
  docker run --rm -v "${MINIO_VOLUME}:/data:ro" -v "$WORK:/backup" alpine \
    tar czf /backup/minio.tar.gz -C /data .
fi

if [[ -d "$CONFIG_ROOT" ]]; then
  echo "==> Archiving deployment configuration"
  mkdir -p "$WORK/configs"
  for item in .env .env.production docker-compose.yml docker-compose.production.yml infrastructure installer Makefile; do
    [[ -e "$CONFIG_ROOT/$item" ]] && cp -a "$CONFIG_ROOT/$item" "$WORK/configs/"
  done
  tar czf "$WORK/configs.tar.gz" -C "$WORK" configs
  rm -rf "$WORK/configs"
else
  echo "CONFIG_ROOT does not exist: $CONFIG_ROOT" >&2
  exit 1
fi

printf '%s\n' "RIAL backup $TS" > "$WORK/MANIFEST.sha256"
for item in pg.dump minio.tar.gz configs.tar.gz; do
  [[ -f "$WORK/$item" ]] && sha256sum "$WORK/$item" >> "$WORK/MANIFEST.sha256"
done

ARCHIVE="$WORK/rial-${TS}.tar.gz"
tar czf "$ARCHIVE" -C "$WORK" $(find "$WORK" -maxdepth 1 -type f -printf '%f\n' \
  | grep -v -E "^(rial-${TS}\\.tar\\.gz|\\.backup-passphrase)$" | sort)
ENCRYPTED="${ARCHIVE}.gpg"
echo "==> Encrypting archive"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$WORK/.backup-passphrase" \
  --symmetric --cipher-algo AES256 --output "$ENCRYPTED" "$ARCHIVE"

AWS_ACCESS_KEY_ID="$MINIO_ROOT_USER" AWS_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
  aws --endpoint-url "$S3_ENDPOINT" s3 cp "$ENCRYPTED" "s3://${BACKUP_S3_BUCKET}/${TS}/"

if [[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "==> Pruning backups older than ${BACKUP_RETENTION_DAYS} days"
  AWS_ACCESS_KEY_ID="$MINIO_ROOT_USER" AWS_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
    aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://${BACKUP_S3_BUCKET}/" | while read -r date time size key; do
      [[ "$key" =~ ^[0-9]{8}T[0-9]{6}Z/$ ]] || continue
      stamp="${key%/}"
      epoch="$(date -u -d "${stamp:0:8} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2>/dev/null || echo 0)"
      age=$(( ( $(date -u +%s) - epoch ) / 86400 ))
      if (( epoch > 0 && age > BACKUP_RETENTION_DAYS )); then
        AWS_ACCESS_KEY_ID="$MINIO_ROOT_USER" AWS_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
          aws --endpoint-url "$S3_ENDPOINT" s3 rm --recursive "s3://${BACKUP_S3_BUCKET}/${stamp}/"
      fi
    done
else
  echo "BACKUP_RETENTION_DAYS must be numeric" >&2
  exit 1
fi

echo "Backup complete: s3://${BACKUP_S3_BUCKET}/${TS}/$(basename "$ENCRYPTED")"
