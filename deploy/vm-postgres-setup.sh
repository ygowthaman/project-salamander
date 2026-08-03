#!/usr/bin/env bash
# Run this ON the VM (after `gcloud compute ssh salamander-db --tunnel-through-iap`)
# to install Postgres and make it reachable from the VPC subnet.
#
# Usage on the VM:
#   export PG_PASSWORD='choose-a-strong-password'
#   export SUBNET_CIDR='10.10.0.0/24'      # must match the subnet Cloud Run egresses from
#   bash vm-postgres-setup.sh
set -euo pipefail

: "${PG_PASSWORD:?set PG_PASSWORD before running}"
SUBNET_CIDR="${SUBNET_CIDR:-10.10.0.0/24}"

sudo apt-get update
sudo apt-get install -y postgresql

# Debian 12 ships PostgreSQL 15. That's fine — the Drizzle migrations are plain
# SQL and run identically. (To pin v16, add the PGDG apt repo before installing.)
PG_CONF_DIR=$(sudo find /etc/postgresql -maxdepth 2 -name main -type d | head -1)

sudo -u postgres psql -c "ALTER USER postgres PASSWORD '${PG_PASSWORD}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='salaman_db'" \
  | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE salaman_db;"

# Listen on all interfaces (private IP only — the VM has no public IP).
echo "listen_addresses = '*'" | sudo tee -a "${PG_CONF_DIR}/postgresql.conf" >/dev/null

# Allow password auth from within the VPC subnet only.
echo "host all all ${SUBNET_CIDR} scram-sha-256" \
  | sudo tee -a "${PG_CONF_DIR}/pg_hba.conf" >/dev/null

sudo systemctl restart postgresql
sudo systemctl enable postgresql

echo "Postgres ready. DB 'salaman_db' on this VM's private IP:5432, open to ${SUBNET_CIDR}."
