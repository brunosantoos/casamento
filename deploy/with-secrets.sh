#!/bin/sh
# Lê os Docker secrets (/run/secrets/*) para variáveis de processo, só em memória.
set -eu
read_secret() { [ -f "/run/secrets/$1" ] && cat "/run/secrets/$1" || true; }
DB_PASSWORD="$(read_secret db_password)"
export DATABASE_URL="postgresql://casa:${DB_PASSWORD}@${DB_HOST:-postgres}:5432/casamento"
export MASTER_KEY="$(read_secret master_key)"
export BETTER_AUTH_SECRET="$(read_secret better_auth_secret)"
export S3_ACCESS_KEY="$(read_secret s3_access_key)"
export S3_SECRET_KEY="$(read_secret s3_secret_key)"
[ -f /run/secrets/smtp_pass ] && export SMTP_PASS="$(read_secret smtp_pass)"
exec "$@"
