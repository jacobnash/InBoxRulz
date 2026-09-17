#!/usr/bin/env bash
# Run once on nash-srv, from the repo root, before the first `docker compose up`.
# Generates ./secrets/* (gitignored) for docker-compose.yml's `secrets:` block.
# Safe to re-run: never overwrites a secret that already exists.
set -euo pipefail
cd "$(dirname "$0")/../.."

mkdir -p secrets
gen() {
  local name="$1" file="secrets/$name"
  if [[ -f "$file" ]]; then
    echo "secrets/$name already exists, leaving it alone"
    return
  fi
  "${@:2}" > "$file"
  chmod 600 "$file"
  echo "wrote secrets/$name"
}

gen postgres_password bash -c 'openssl rand -base64 24'
gen credentials_encryption_key bash -c 'openssl rand -base64 32'
[[ -f secrets/anthropic_api_key ]] || { touch secrets/anthropic_api_key; chmod 600 secrets/anthropic_api_key; echo "wrote secrets/anthropic_api_key (empty — fill in for real LLM rescue classification, optional)"; }

if [[ ! -f secrets/database_url ]]; then
  pw=$(cat secrets/postgres_password)
  printf 'postgresql://inboxrulz:%s@postgres:5432/inboxrulz' "$pw" > secrets/database_url
  chmod 600 secrets/database_url
  echo "wrote secrets/database_url"
fi

echo "done — review secrets/anthropic_api_key if you want real LLM rescue judgment, then: docker compose --env-file deploy/nash-srv/.env up -d --build"
