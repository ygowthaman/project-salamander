# Salamander — Deployment (Cloud Run + self-managed Postgres on a VM)

This runbook deploys Salamander to GCP with a **self-managed PostgreSQL on a
Compute Engine VM** instead of Cloud SQL. The backend runs on Cloud Run and
reaches the VM over a private IP using **Direct VPC egress**; the frontend is a
static build on **Firebase Hosting**.

> **Trade-off you're accepting:** the VM is cheaper (an `e2-micro` is free-tier
> eligible in `us-central1`) and fully under your control, but you own backups,
> patching, and uptime. There is no managed failover. Fine for a POC. If this
> app grows, migrate to Cloud SQL (see `ARCHITECTURE.md` → Deployment).

## Why the extra networking (vs. the Cloud SQL design)

Cloud Run is serverless and cannot reach a VM's private IP by default. The
`ARCHITECTURE.md` design used the Cloud SQL Auth Proxy sidecar specifically to
avoid VPC networking. Putting Postgres on a VM brings that requirement back:

- **Direct VPC egress** connects the Cloud Run service into your VPC so it can
  reach the VM's internal IP on `5432`. No hourly connector cost.
- **Cloud NAT** lets the VM (which has *no public IP*) reach the internet to
  install packages.
- **IAP SSH** lets you admin the no-public-IP VM without exposing port 22.

---

## 0. Variables

Set these once per shell. Replace `PROJECT_ID` and pick a strong DB password.

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"          # free-tier e2-micro region
export ZONE="us-central1-a"
export SUBNET_CIDR="10.10.0.0/24"
export PG_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=')"   # or set your own

gcloud config set project "$PROJECT_ID"
echo "Save this DB password somewhere safe: $PG_PASSWORD"
```

## 1. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

## 2. Network: VPC, subnet, firewall, NAT

```bash
# Custom VPC + one subnet (shared by the VM and Cloud Run's egress).
gcloud compute networks create salamander-vpc --subnet-mode=custom
gcloud compute networks subnets create salamander-subnet \
  --network=salamander-vpc --region="$REGION" --range="$SUBNET_CIDR"

# Postgres reachable only from inside the subnet (this covers Cloud Run's egress IPs).
gcloud compute firewall-rules create salamander-allow-pg-internal \
  --network=salamander-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:5432 --source-ranges="$SUBNET_CIDR"

# SSH to the VM via IAP only (no public IP on the VM).
gcloud compute firewall-rules create salamander-allow-iap-ssh \
  --network=salamander-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:22 --source-ranges=35.235.240.0/20

# Cloud NAT so the no-public-IP VM can download packages.
gcloud compute routers create salamander-router \
  --network=salamander-vpc --region="$REGION"
gcloud compute routers nats create salamander-nat \
  --router=salamander-router --region="$REGION" \
  --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
```

> A single `/24` shared by the VM and Cloud Run is fine for a POC. If the backend
> ever scales to many instances, give Cloud Run its own subnet — Direct VPC
> egress consumes one subnet IP per instance.

## 3. The database VM

```bash
gcloud compute instances create salamander-db \
  --zone="$ZONE" --machine-type=e2-micro \
  --network=salamander-vpc --subnet=salamander-subnet \
  --no-address \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=20GB
```

> **`e2-micro` is free-tier but heavily contended** — you may hit
> `ZONE_RESOURCE_POOL_EXHAUSTED`. It means Google is out of that machine type in
> that zone right now, not a config error. Loop over the region's zones
> (`for z in ${REGION}-a ${REGION}-b ${REGION}-c; do ... --zone="$z" ... && break; done`),
> and if a whole region is dry, move to another free-tier region (`us-west1`,
> `us-east1`) — but then you must recreate the **subnet, router, and NAT** in the
> new region (the VPC is global and stays; those three are regional). Reusing the
> same `SUBNET_CIDR` in the new region keeps the firewall rule valid unchanged.

SSH in (over IAP) and install Postgres using the helper script:

```bash
# From your machine, copy the helper up and run it on the VM:
gcloud compute scp deploy/vm-postgres-setup.sh salamander-db:~ \
  --zone="$ZONE" --tunnel-through-iap

gcloud compute ssh salamander-db --zone="$ZONE" --tunnel-through-iap --command="\
  export PG_PASSWORD='$PG_PASSWORD'; \
  export SUBNET_CIDR='$SUBNET_CIDR'; \
  bash ~/vm-postgres-setup.sh"
```

Capture the VM's internal IP — it goes into `DATABASE_URL`:

```bash
export VM_IP=$(gcloud compute instances describe salamander-db --zone="$ZONE" \
  --format='get(networkInterfaces[0].networkIP)')
echo "VM internal IP: $VM_IP"
```

## 4. Secrets

```bash
# Anthropic key (paste yours):
printf '%s' "sk-ant-REPLACE_ME" | \
  gcloud secrets create anthropic-api-key --data-file=-

# DATABASE_URL pointing at the VM's private IP:
printf 'postgresql://postgres:%s@%s:5432/shopping' "$PG_PASSWORD" "$VM_IP" | \
  gcloud secrets create database-url --data-file=-

# Let Cloud Run's runtime service account read both secrets.
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in anthropic-api-key database-url; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor
done
```

## 5. Deploy the backend (Cloud Run + Direct VPC egress)

`--network`/`--subnet` turn on Direct VPC egress; `--vpc-egress=private-ranges-only`
sends only RFC-1918 traffic (the VM) through the VPC, so Anthropic API calls
still go out the normal path. The three WebSocket flags are from `ARCHITECTURE.md`.

```bash
gcloud run deploy salamander-server \
  --source node-server \
  --region="$REGION" \
  --allow-unauthenticated \
  --network=salamander-vpc \
  --subnet=salamander-subnet \
  --vpc-egress=private-ranges-only \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest,DATABASE_URL=database-url:latest \
  --set-env-vars="^##^ALLOWED_ORIGINS=https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com" \
  --session-affinity \
  --timeout=3600 \
  --min-instances=1
```

> **`^##^` is not optional.** `ALLOWED_ORIGINS` contains a comma, and gcloud uses
> commas to separate *different* env vars — so an unescaped value fails with
> `Bad syntax for dict arg`. The `^##^` prefix switches the delimiter to `##` for
> this flag so the comma inside the value is left alone.

The container runs pending migrations on boot, so the **DB must be reachable
before this deploy** — if it isn't, the container exits and the deploy fails its
health check. Grab the URL:

```bash
export BACKEND_URL=$(gcloud run services describe salamander-server \
  --region="$REGION" --format='value(status.url)')
echo "$BACKEND_URL"

# Smoke test:
curl -sX POST "$BACKEND_URL/sessions" -H 'Content-Type: application/json' -d '{}'
# → {"id":"...","title":"New Session","created_at":"..."}
```

## 6. Deploy the frontend (Firebase Hosting)

The Vite build **bakes in** the backend URLs, so build *after* the backend exists.
`VITE_WS_URL` uses `wss://` (the page is served over HTTPS).

```bash
cd frontend
cat > .env.production <<EOF
VITE_API_URL=${BACKEND_URL}
VITE_WS_URL=$(echo "$BACKEND_URL" | sed 's/^https/wss/')
EOF

npm install
npm run build          # → frontend/dist
```

**Add Firebase to the project — do this in the console, once.** The CLI's
`firebase projects:addfirebase` fails (`Failed to add Firebase…`) for an account
that has never created a Firebase project, because it can't accept the Terms of
Service for you. Clear it once by hand:

1. Go to [console.firebase.google.com](https://console.firebase.google.com),
   signed in as the **same Google account that owns the GCP project**.
2. **Create a project** → in the name box, type the existing project ID
   (`$PROJECT_ID`) and pick it from the **existing-Google-Cloud-projects**
   dropdown that appears — don't create a new one. (Deep link if the dropdown
   won't show it: `https://console.firebase.google.com/project/<PROJECT_ID>/overview`.)
3. Accept the terms; turn Google Analytics **off**. If it asks for a billing
   plan, pick **Blaze / pay-as-you-go** — the project already has billing, and
   Hosting stays within the free quota (~$0 for a static SPA).

Then deploy from the CLI (config written directly — no interactive `firebase init`):

```bash
firebase login   # in Cloud Shell: firebase login --no-localhost

cat > firebase.json <<'EOF'
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
EOF
cat > .firebaserc <<EOF
{ "projects": { "default": "${PROJECT_ID}" } }
EOF

firebase deploy --only hosting --project "$PROJECT_ID"
```

Your app is now at `https://${PROJECT_ID}.web.app` — which is already in the
backend's `ALLOWED_ORIGINS`, so CORS and the WebSocket handshake work. (Firebase
Hosting is global; only the backend/DB region matters.)

---

## Redeploys

- **Backend code change:** `gcloud run deploy salamander-server --source node-server --region="$REGION"`
  (flags persist across deploys; you only re-pass them to change them).
- **Frontend change:** `cd frontend && npm run build && firebase deploy --only hosting`.
- **New DB migration:** commit the generated SQL under `node-server/drizzle/`; the
  next backend deploy applies it on boot.

## Operational notes for a self-managed DB

- **Backups:** nothing is automatic. Either schedule a snapshot of the VM's disk
  (`gcloud compute disks snapshot`) or a `pg_dump` cron to a GCS bucket.
- **The WebSocket 1-hour cap** (`--timeout=3600`) still applies; sockets die at
  the hour mark and the frontend has no reconnect yet (see `ARCHITECTURE.md` →
  Known gaps).
- **Cost watch:** e2-micro + Direct VPC egress are cheap/free-tier; Cloud NAT and
  `--min-instances=1` are the small recurring line items.
