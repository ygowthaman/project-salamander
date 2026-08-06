#!/usr/bin/env bash
set -euo pipefail

: "${PG_PASSWORD:?set PG_PASSWORD before running}"
SUBNET_CIDR="${SUBNET_CIDR:-10.10.0.0/24}"

sudo apt-get update
sudo apt-get install -y postgresql

PG_CONF_DIR=$(sudo find /etc/postgresql -maxdepth 2 -name main -type d | head -1)

sudo -u postgres psql -c "ALTER USER postgres PASSWORD '${PG_PASSWORD}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='salaman_db'" \
  | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE salaman_db;"

echo "listen_addresses = '*'" | sudo tee -a "${PG_CONF_DIR}/postgresql.conf" >/dev/null

echo "host all all ${SUBNET_CIDR} scram-sha-256" \
  | sudo tee -a "${PG_CONF_DIR}/pg_hba.conf" >/dev/null

sudo systemctl restart postgresql
sudo systemctl enable postgresql

echo "Postgres ready. DB 'salaman_db' on this VM's private IP:5432, open to ${SUBNET_CIDR}."
