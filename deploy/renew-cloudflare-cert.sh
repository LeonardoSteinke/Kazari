#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOMELAB_DIR="$(cd -- "$PROJECT_DIR/../.." && pwd)"
TOKEN_FILE="$PROJECT_DIR/deploy/cloudflare.env"
ACME_DIR="$HOMELAB_DIR/config/nginx-proxy/ssl/kazari-acme"
CERT_DIR="$HOMELAB_DIR/config/nginx-proxy/ssl/kazari-public"
DOMAIN="kazari.mockingbird.com.br"
IMAGE="neilpang/acme.sh:latest"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Missing $TOKEN_FILE; copy cloudflare.env.example and add the scoped API token." >&2
  exit 1
fi
chmod 600 "$TOKEN_FILE"

mkdir -p "$ACME_DIR" "$CERT_DIR"
chmod 700 "$ACME_DIR" "$CERT_DIR"

if [[ -f "$CERT_DIR/fullchain.pem" ]]; then
  ACME_ACTION=(--renew --server letsencrypt -d "$DOMAIN")
else
  ACME_ACTION=(--issue --server letsencrypt --dns dns_cf -d "$DOMAIN")
fi

docker run --rm \
  --env-file "$TOKEN_FILE" \
  -v "$ACME_DIR:/acme.sh" \
  -v "$CERT_DIR:/certs" \
  "$IMAGE" "${ACME_ACTION[@]}"

docker run --rm \
  --env-file "$TOKEN_FILE" \
  -v "$ACME_DIR:/acme.sh" \
  -v "$CERT_DIR:/certs" \
  "$IMAGE" --install-cert -d "$DOMAIN" \
    --key-file /certs/privkey.pem \
    --fullchain-file /certs/fullchain.pem

docker exec nginx-proxy nginx -t
docker exec nginx-proxy nginx -s reload
echo "Installed and reloaded certificate for $DOMAIN"
