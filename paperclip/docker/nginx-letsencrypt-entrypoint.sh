#!/bin/sh
set -eu

DOMAIN="${DOMAIN:?DOMAIN is required}"
BOOTSTRAP_TEMPLATE="/templates/nginx-letsencrypt.bootstrap.conf.template"
TLS_TEMPLATE="/templates/nginx-letsencrypt.conf.template"
TARGET_CONF="/etc/nginx/nginx.conf"
LIVE_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [ -f "$LIVE_CERT" ]; then
  sed "s|__DOMAIN__|${DOMAIN}|g" "$TLS_TEMPLATE" > "$TARGET_CONF"
  echo "Using TLS nginx config for ${DOMAIN}"
else
  sed "s|__DOMAIN__|${DOMAIN}|g" "$BOOTSTRAP_TEMPLATE" > "$TARGET_CONF"
  echo "Using bootstrap HTTP-only nginx config for ${DOMAIN}"
fi

exec nginx -g 'daemon off;'
