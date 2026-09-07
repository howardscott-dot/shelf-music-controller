#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/shelf"
SERVICE_USER="shelf"
SERVICE_FILE="/etc/systemd/system/shelf.service"

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this installer as root inside the SHELF LXC.\n' >&2
  exit 1
fi

if [[ "$(pwd -P)" != "${APP_DIR}" ]]; then
  printf 'Place the project at %s and run this installer from that directory.\n' "${APP_DIR}" >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/.env" ]]; then
  printf 'Missing %s/.env. Copy .env.example and fill in the Jellyfin and WiiM settings first.\n' "${APP_DIR}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js 20 or newer and npm must be installed first.\n' >&2
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 20 )); then
  printf 'Node.js 20 or newer is required; found %s.\n' "$(node --version)" >&2
  exit 1
fi

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

npm ci
npm run build
npm prune --omit=dev

install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0750 "${APP_DIR}/.cache"
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0700 "${APP_DIR}/.data"
chown root:"${SERVICE_USER}" "${APP_DIR}/.env"
chmod 0640 "${APP_DIR}/.env"

NODE_BINARY="$(command -v node)"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=SHELF music controller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=8787
ExecStart=${NODE_BINARY} ${APP_DIR}/apps/server/dist/index.js
Restart=on-failure
RestartSec=4
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR}/.cache ${APP_DIR}/.data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable shelf.service
systemctl restart shelf.service

for attempt in {1..10}; do
  if node -e "fetch('http://127.0.0.1:8787/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"; then
    LAN_ADDRESS="$(hostname -I | awk '{print $1}')"
    printf 'SHELF is running at http://%s:8787/\n' "${LAN_ADDRESS}"
    exit 0
  fi
  sleep 1
done

printf 'SHELF did not pass its health check. Inspect: journalctl -u shelf -n 100 --no-pager\n' >&2
exit 1
