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
printf 'postgresql://postgres:%s@%s:5432/salaman_db' "$PG_PASSWORD" "$VM_IP" | \
  gcloud secrets create database-url --data-file=-

# JWT signing secret (auth). Must be >= 32 chars; rotating it invalidates all
# outstanding access tokens, which the refresh flow recovers from.
openssl rand -base64 32 | tr -d '\n' | \
  gcloud secrets create jwt-secret --data-file=-

# Google OAuth client secret — see §9 for creating the client itself.
printf '%s' "GOCSPX-REPLACE_ME" | \
  gcloud secrets create google-client-secret --data-file=-

# The seed account the reset job creates (§5a). All three are secrets rather
# than plain env vars so none of them — the password least of all — is readable
# from the repository or from a deploy command in it.
printf '%s' "REPLACE_ME@example.com" | gcloud secrets create seed-user-email --data-file=-
printf '%s' "REPLACE_ME"             | gcloud secrets create seed-user-password --data-file=-
printf '%s' "REPLACE ME"             | gcloud secrets create seed-user-name --data-file=-

# Let Cloud Run's runtime service account read the secrets.
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in anthropic-api-key database-url jwt-secret google-client-secret \
         seed-user-email seed-user-password seed-user-name; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor
done
```

## 5. Deploy the backend (Cloud Run + Direct VPC egress)

### 5a. The deploy-time reset job

While the schema is still being drafted, **every deploy rebuilds the database
from empty and reseeds one account** — the same republish cycle `npm run db:reset`
runs locally. Production is a test environment and holds nothing worth keeping;
this is what lets a schema change ship without a hand-written catch-up migration.

It runs as a **Cloud Run job**, and deliberately not on the server's boot path.
Cloud Run starts instances on autoscale events and health-check restarts, not
only on deploys, so a reset in `server.ts` would eventually wipe the database out
from under an instance already serving traffic. A job fires exactly once, when
you run it.

Create it once — same source tree as the service, different entrypoint:

```bash
gcloud run jobs deploy salamander-db-reset \
  --source node-server \
  --region="$REGION" \
  --command=node \
  --args=dist/db/migrate.js,--reset \
  --network=salamander-vpc \
  --subnet=salamander-subnet \
  --vpc-egress=private-ranges-only \
  --set-secrets=DATABASE_URL=database-url:latest,SEED_USER_EMAIL=seed-user-email:latest,SEED_USER_PASSWORD=seed-user-password:latest,SEED_USER_NAME=seed-user-name:latest \
  --set-env-vars=ALLOW_DESTRUCTIVE_RESET=1 \
  --max-retries=0
```

Then run it, before every service deploy:

```bash
gcloud run jobs execute salamander-db-reset --region="$REGION" --wait
```

> **`ALLOW_DESTRUCTIVE_RESET=1` is what makes the drop legal**, and it belongs on
> the job and nowhere else. Cloud Buildpacks set `NODE_ENV=production` on the job
> and the service alike, so `migrate.ts` cannot tell them apart from the
> environment; this variable is the distinction. Without it a `--reset` in
> production refuses and exits non-zero. **Never set it on the service.**

> **`--max-retries=0`** — a failed reset must not be retried on its own. The retry
> would drop a database the first attempt may already have rebuilt.

The job carries only `DATABASE_URL` and the three seed secrets: the migrate
entrypoint imports the database client and the seeder, not the app, so it needs
neither the Anthropic key nor the JWT/OAuth config. The seed variables have no
defaults and are **validated before anything is dropped**, so a missing one fails
the job with the database still intact.

### 5b. The service

`--network`/`--subnet` turn on Direct VPC egress; `--vpc-egress=private-ranges-only`
sends only RFC-1918 traffic (the VM) through the VPC, so Anthropic API calls
still go out the normal path. `--session-affinity`, `--timeout=3600` and
`--min-instances=1` are from `ARCHITECTURE.md`.

```bash
gcloud run deploy salamander-server \
  --source node-server \
  --region="$REGION" \
  --allow-unauthenticated \
  --network=salamander-vpc \
  --subnet=salamander-subnet \
  --vpc-egress=private-ranges-only \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest,DATABASE_URL=database-url:latest,JWT_SECRET=jwt-secret:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest \
  --set-env-vars="^##^ALLOWED_ORIGINS=https://salamander.axoliz.ai##PUBLIC_API_URL=https://api.axoliz.ai##FRONTEND_URL=https://salamander.axoliz.ai##COOKIE_DOMAIN=axoliz.ai##GOOGLE_CLIENT_ID=REPLACE.apps.googleusercontent.com" \
  --session-affinity \
  --timeout=3600 \
  --min-instances=1
```

> **`COOKIE_DOMAIN=axoliz.ai` is what makes authentication work at all.** Auth
> cookies are `SameSite=Lax`, so the browser omits them on *cross-site* requests.
> Because `run.app` is on the Public Suffix List, the `run.app` URL and
> `salamander.axoliz.ai` are different sites — every authenticated call would
> arrive cookie-less and 401 while working fine on localhost. §8 maps the service
> to `api.axoliz.ai` so both sides sit under `axoliz.ai`; set `PUBLIC_API_URL`
> and `FRONTEND_URL` to the mapped hostnames, not the `run.app` one.

> **`^##^` is not optional.** `ALLOWED_ORIGINS` contains a comma, and gcloud uses
> commas to separate *different* env vars — so an unescaped value fails with
> `Bad syntax for dict arg`. The `^##^` prefix switches the delimiter to `##` for
> this flag so the comma inside the value is left alone.

> **`--session-affinity` is load-bearing twice over.** It pins a WebSocket to one
> instance, and it keeps each turn of an interpretation exchange arriving at the
> instance holding that exchange — those turns live in that instance's memory and
> nowhere else. Affinity here is best effort, so a scale-down or a new revision
> can still strand an exchange: the user is told to start again and nothing is
> written. Dropping the flag turns that from rare into routine.

The container still calls `runMigrations()` on boot — a no-op against the
database 5a just rebuilt, but it means the **DB must be reachable
before this deploy** — if it isn't, the container exits and the deploy fails its
health check. Grab the URL:

```bash
export BACKEND_URL=$(gcloud run services describe salamander-server \
  --region="$REGION" --format='value(status.url)')
echo "$BACKEND_URL"

# Smoke test — unauthenticated and database-free, so it reports that the process
# is serving rather than that Postgres is reachable:
curl -s "$BACKEND_URL/health"
# → {"status":"ok"}
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

## 7. Custom domain (Cloudflare → Firebase Hosting)

Points a subdomain you own (e.g. `salamander.axoliz.ai`, DNS on Cloudflare) at
the Firebase-hosted frontend. The **backend keeps its `run.app` URL** — it's
baked into the build and called directly, so it needs no domain and the frontend
needs **no rebuild** (same build, new hostname). Live domain: `salamander.axoliz.ai`.

### 7a. Allow the new origin on the backend — **do this first**

`server.ts` restricts CORS to `ALLOWED_ORIGINS`. Serving the app from the new
hostname changes the browser's `Origin`, so without this **every REST call fails
CORS** the moment the domain goes live. Add the origin (keep the existing ones):

```bash
gcloud run services update salamander-server --region="$REGION" \
  --update-env-vars="^##^ALLOWED_ORIGINS=https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com,https://salamander.axoliz.ai"
```

Same `^##^` delimiter trick as the first deploy (the value contains commas). It's
harmless to run before the domain resolves, so do it up front to avoid a
broken-CORS window.

### 7b. Add the domain in Firebase

1. Firebase console → **Hosting** → **Add custom domain** → enter the subdomain.
2. Firebase returns the DNS record to create. The current flow returns a single
   **CNAME** (`salamander` → `${PROJECT_ID}.web.app`); older flows returned two
   `A` records to `199.36.30.x`. Either works — create whatever it shows.

### 7c. Create the record in Cloudflare

Cloudflare → the zone (`axoliz.ai`) → **DNS** → **Add record**:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `salamander` | `${PROJECT_ID}.web.app` | **DNS only (grey cloud)** |

- **Name is the subdomain label only** (`salamander`), not the FQDN — Cloudflare
  appends the zone. Typing the full name yields `salamander.axoliz.ai.axoliz.ai`.
- **Target has no `https://` / trailing slash.**
- **Grey cloud, not orange.** Firebase provisions its cert via an ACME challenge
  that must reach Firebase directly; Cloudflare's proxy intercepts it and cert
  minting stalls. (You can switch to orange *after* the cert is issued, but then
  you must also set Cloudflare SSL mode to **Full** or you get a redirect loop.
  Simplest is to leave it grey — Firebase serves HTTPS itself.)

### 7d. Verify, then wait for the certificate

Click **Verify**/**Finish** in Firebase. Then two waits:

- **DNS propagation** — a fresh Cloudflare record is usually live in minutes.
  Check with `dig +short salamander.axoliz.ai`; correct output shows the
  `...web.app` chain and/or `199.36.30.x` IPs. Cloudflare IPs (`104.x`, `172.67.x`)
  mean the record is still proxied (orange) — flip it to grey.
- **Certificate minting** — Firebase shows **"Minting Certificate"** and browsers
  throw `ERR_CERT_COMMON_NAME_INVALID` in the meantime. **This is expected**: DNS
  is correct, Firebase just hasn't installed your cert yet. Usually 30–60 min,
  worst case ~24h. Don't bypass the warning — it clears itself when the Hosting
  page flips to **Connected**. Then hard-refresh (Ctrl+Shift+R).

Because 7a already allowed the origin, REST calls and the WebSocket work the
instant the cert is live.

## 8. Backend custom domain (`api.axoliz.ai`) — required for authentication

Until auth landed, the frontend could call the backend on its `run.app` URL.
**It can no longer.** Auth cookies are `SameSite=Lax`, and `run.app` is on the
Public Suffix List, so `salamander-server-….run.app` and `salamander.axoliz.ai`
are *different sites*: the browser refuses to attach the cookie to any
cross-site fetch. Everything works on localhost (same site) and then 401s in
production. Putting the API on `api.axoliz.ai` puts both under `axoliz.ai`.

```bash
gcloud beta run domain-mappings create \
  --service=salamander-server \
  --domain=api.axoliz.ai \
  --region="$REGION"
```

The command prints the DNS record to create — normally a `CNAME` to
`ghs.googlehosted.com.`. Add it in Cloudflare exactly as for the frontend:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `api` | `ghs.googlehosted.com` | **DNS only (grey cloud)** |

Grey cloud again — Google mints the certificate via a challenge that must reach
it directly. Expect the same "provisioning certificate" wait as §7d.

> **If `domain-mappings` is unavailable in your region**, the supported
> alternative is a global external Application Load Balancer with a serverless
> NEG pointing at the service. **Do not** reach for the Firebase Hosting →
> Cloud Run rewrite as a shortcut: it would make the API same-origin, but
> **Firebase Hosting does not proxy WebSockets**, so chat would break entirely.

Then rebuild the frontend against the new hostname (the URLs are baked in at
build time) and redeploy it:

```bash
cd frontend
cat > .env.production <<'EOF'
VITE_API_URL=https://api.axoliz.ai
VITE_WS_URL=wss://api.axoliz.ai
EOF
npm run build
firebase deploy --only hosting --project "$PROJECT_ID"
```

## 9. Google OAuth client

In the Cloud console → **APIs & Services**:

1. **OAuth consent screen** — User type **External**. While the app is
   unpublished, only accounts listed under **Test users** can sign in, so add
   your own. Scopes needed are just `openid`, `email`, `profile`.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorised JavaScript origins:** `https://salamander.axoliz.ai`
   - **Authorised redirect URIs:**
     - `https://api.axoliz.ai/auth/google/callback`
     - `http://localhost:8000/auth/google/callback` (local dev)

The redirect URI must match `${PUBLIC_API_URL}/auth/google/callback`
**character for character**, or Google rejects the request with
`redirect_uri_mismatch` before the user ever sees a consent screen.

Put the client ID in `GOOGLE_CLIENT_ID` (a plain env var — it is public) and the
secret in the `google-client-secret` Secret Manager entry from §4.

---

## Redeploys

**Deployment is fully manual.** Nothing is triggered by a `git commit` or push —
there is no CI/CD or Cloud Build trigger wired up. Committing only updates the
repo; production changes *only* when you run one of the commands below. (To make
it automatic later you'd connect the repo via Cloud Run → *Set up continuous
deployment*, but that's intentionally not enabled.)

Run these from **Cloud Shell** after cloning/pulling the latest code. The live
service is in **us-west1**, project **`project-salamander-503418`**.

**Backend code change** — from the repo root. Three commands, in this order: the
job is rebuilt from the new source (it replays the `drizzle/` baseline out of its
own image, so a stale job would replay the old schema), then run, then the
service.

```bash
cd ~/project-salamander && git pull

gcloud run jobs deploy salamander-db-reset --source node-server --region=us-west1
gcloud run jobs execute salamander-db-reset --region=us-west1 --wait
gcloud run deploy salamander-server --source node-server --region=us-west1
```

The VPC, secrets, and flags persist across deploys on both the job and the
service, so you don't re-pass them unless you're changing one.

> **Every deploy destroys the production database**, including whatever you were
> testing with — you come back up with the seed account and nothing else. That is
> the deliberate arrangement while the schema is in flux (§5a), and it is why a
> schema change needs no catch-up migration: run `npm run db:reset` locally,
> commit the regenerated `drizzle/0000_init.sql`, and redeploy.

**Frontend change** — the backend URL is baked in at build time, so `.env.production`
must already exist (it does from the first deploy):

```bash
cd ~/project-salamander/frontend && git pull
npm run build
firebase deploy --only hosting --project project-salamander-503418
```

Each redeploy creates a new versioned revision/release, so you can roll back from
the Cloud Run or Firebase Hosting console if a deploy goes wrong.

## Operational notes for a self-managed DB

- **Backups:** nothing is automatic. Either schedule a snapshot of the VM's disk
  (`gcloud compute disks snapshot`) or a `pg_dump` cron to a GCS bucket.
- **The WebSocket 1-hour cap** (`--timeout=3600`) still applies; sockets die at
  the hour mark and the frontend has no reconnect yet (see `ARCHITECTURE.md` →
  Known gaps).
- **Cost watch:** e2-micro + Direct VPC egress are cheap/free-tier; Cloud NAT and
  `--min-instances=1` are the small recurring line items.
