#!/usr/bin/env bash
set -euo pipefail
revision=${1:?commit SHA required}
registry_user=${2:?registry user required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
root=/opt/e-property-mn
release="$root/releases/$revision"
[[ -s "$root/.env" ]] || { echo 'Provision /opt/e-property-mn/.env first' >&2; exit 1; }
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another rollout is active' >&2; exit 1; }
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
docker login ghcr.io -u "$registry_user" --password-stdin
cd "$release"
export IMAGE_TAG="$revision"
compose() { docker compose --env-file "$root/.env" -f "$release/compose.yml" "$@"; }
compose config --quiet
compose pull
compose up -d --wait postgres redis
# Preserve a database backup before forward-only migrations.
install -d -m 700 "$root/backups"
umask 077
compose exec -T postgres pg_dump -U eproperty -d eproperty -Fc > "$root/backups/pre-$revision-$(date +%s).dump"
compose run --rm migrate
previous=$(readlink -f "$root/current" || true)
if compose up -d --wait --wait-timeout 180 backend frontend; then
  ln -sfn "$release" "$root/current"
  # Publish the static landing where nginx (not in the deploy group) can read it.
  web=/var/www/e-property-mn
  cp -R "$release/landing" "$web/$revision" && chmod -R a+rX "$web/$revision"
  ln -sfn "$revision" "$web/current.tmp" && mv -T "$web/current.tmp" "$web/current"
  printf '%s\n' "$revision" > "$root/current-revision"
else
  echo 'Rollout failed; attempting previous application images (schema stays forward)' >&2
  if [[ -n "$previous" && -f "$previous/compose.yml" ]]; then
    IMAGE_TAG=$(basename "$previous") docker compose --env-file "$root/.env" -f "$previous/compose.yml" up -d --no-deps --wait backend frontend
  fi
  exit 1
fi
