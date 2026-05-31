# Shopping Agent — Phase 1 Build Plan

## Goal

A simple chat web application where users describe what they want to buy and Claude returns shopping suggestions. This is Phase 1 of a larger autonomous shopping agent. The focus is establishing the core foundation: LLM connectivity, real-time streaming, and session persistence.

No auth, no external search APIs, no browser automation, no payments in Phase 1.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Python + FastAPI |
| LLM | Claude API via Anthropic Python SDK (`claude-sonnet-4-6`) |
| Real-time | WebSockets (FastAPI native) |
| Database | PostgreSQL + SQLAlchemy (async) |
| Local Dev DB | Docker Compose |
| Deployment | Google Cloud Platform |

---

## Architecture

```
Browser (React)
  │
  │  HTTPS + WSS
  ▼
Cloud Run — Frontend (Nginx serving React static build)
  │
  │  API calls + WebSocket
  ▼
Cloud Run — Backend (FastAPI + Uvicorn)
  ├── WebSocket handler (/ws/{session_id})
  ├── REST: POST /sessions
  ├── REST: GET /sessions/{id}/history
  └── Claude SDK streaming
  │
  │  via Cloud SQL Auth Proxy (sidecar)
  ▼
Cloud SQL — PostgreSQL
  ├── sessions table
  └── messages table

Secret Manager
  ├── ANTHROPIC_API_KEY
  └── DATABASE_URL
```

---

## Data Model

```sql
sessions
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
  title       TEXT              -- truncated first user message
  created_at  TIMESTAMPTZ DEFAULT now()

messages
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
  session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE
  role        TEXT NOT NULL     -- 'user' | 'assistant'
  content     TEXT NOT NULL
  created_at  TIMESTAMPTZ DEFAULT now()
```

Messages are stored in the shape Claude's API expects (role/content), so replaying history into context requires no transformation.

---

## Backend Flow (per message)

```
1. Client connects: WebSocket /ws/{session_id}
2. Client sends JSON: { "message": "I need a laptop under $800" }
3. Backend loads all prior messages for session from DB
4. Saves incoming user message to DB
5. Builds Claude messages array: [...history, new user message]
6. Calls claude.messages.stream(messages=[...], system=SYSTEM_PROMPT)
7. For each token chunk → ws.send_text(chunk)
8. On stream complete → saves assistant message to DB
9. Sends { "type": "done" } signal to client
```

Prompt caching is applied to the system prompt from day one.

---

## System Prompt (agent.py)

The Claude system prompt defines the shopping assistant persona. Isolated in `agent.py` so it can be tuned independently. Start simple:

```
You are a helpful shopping assistant. When a user describes what they want to buy,
ask clarifying questions if needed, then provide specific product suggestions with
reasoning. Include estimated price ranges, key features to look for, and trade-offs
between options. Be concise and practical.
```

---

## Frontend Flow

```
1. On load → POST /sessions → receive session_id
2. Open WebSocket: ws(s)://backend-url/ws/{session_id}
3. User types message → send JSON over WS
4. Tokens arrive (type: "chunk") → append to active message bubble
5. { type: "done" } → finalize bubble, re-enable input
6. Session sidebar → placeholder for now, wired up in Phase 2
```

---

## Project Structure

```
shopping-agent/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket endpoint, REST routes
│   ├── agent.py             # Claude streaming logic, system prompt
│   ├── database.py          # SQLAlchemy async engine + session factory
│   ├── models.py            # ORM models: Session, Message
│   ├── schemas.py           # Pydantic request/response shapes
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env                 # local only — ANTHROPIC_API_KEY, DATABASE_URL
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── InputBar.tsx
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts   # connect, send, stream token handler
│   │   └── api.ts               # REST: createSession, getHistory
│   ├── Dockerfile               # Nginx serving dist/
│   └── ... vite.config, tailwind.config, tsconfig
│
├── docker-compose.yml           # local dev: Postgres only
└── cloudbuild.yaml              # GCP CI/CD pipeline
```

---

## UI Layout

Desktop (responsive, mobile-ready via Tailwind breakpoints):

```
┌─────────────────────────────────────────────┐
│  Shopping Assistant                          │
├─────────────────────────────────────────────┤
│                                             │
│   [assistant bubble] Hi! What are you       │
│   looking to buy today?                     │
│                                             │
│              [user bubble] I need a laptop  │
│                            under $800       │
│                                             │
│   [assistant bubble, streaming...]          │
│                                             │
├─────────────────────────────────────────────┤
│  [ Type what you're looking for...  ] [Send]│
└─────────────────────────────────────────────┘
```

Mobile: same layout, full width. No structural changes needed — just Tailwind breakpoint classes.

---

## Google Cloud Deployment

### Services Used

| Service | Purpose |
|---|---|
| Cloud Run | Backend (FastAPI) and Frontend (Nginx/React) |
| Cloud SQL | Managed PostgreSQL (`db-f1-micro` to start) |
| Artifact Registry | Docker image storage |
| Secret Manager | ANTHROPIC_API_KEY, DATABASE_URL |
| Cloud Build | CI/CD — triggers on push to `main` |
| Cloud SQL Auth Proxy | Sidecar on Cloud Run, avoids need for VPC Connector |

### CI/CD Flow

```
git push main
  └── Cloud Build triggers (cloudbuild.yaml)
        ├── Build backend Docker image
        ├── Push to Artifact Registry
        ├── Deploy backend to Cloud Run
        ├── Build frontend Docker image
        ├── Push to Artifact Registry
        └── Deploy frontend to Cloud Run
```

### Environment Variables (set in Cloud Run, sourced from Secret Manager)

```
ANTHROPIC_API_KEY    → from Secret Manager
DATABASE_URL         → from Secret Manager
ALLOWED_ORIGINS      → frontend Cloud Run URL (CORS)
```

### Cost Estimate (Phase 1)

| Service | Cost |
|---|---|
| Cloud Run (backend + frontend) | Free tier (2M req/mo) |
| Cloud SQL db-f1-micro | ~$7–10/mo |
| Artifact Registry | ~$0.10/GB, negligible |
| Secret Manager | Free tier |
| Cloud SQL Auth Proxy | Free (replaces VPC Connector) |
| **Total** | **~$7–10/mo** |

---

## Local Development

```bash
# Start local Postgres
docker-compose up -d

# Backend
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

Local `.env` (never committed):
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/shopping
```

---

## Build Order

1. **Backend** — models, database, agent (Claude streaming), FastAPI routes + WebSocket
2. **Frontend** — React chat UI, useWebSocket hook, API calls
3. **Dockerfiles** — backend (Python) and frontend (Nginx)
4. **docker-compose.yml** — local Postgres for dev
5. **GCP setup** — project, Cloud SQL, Artifact Registry, Secret Manager, service accounts
6. **cloudbuild.yaml** — CI/CD pipeline

---

## Future Phases (out of scope for Phase 1)

- **Phase 2**: Product search tools (SerpAPI / Brave Search), Claude tool use
- **Phase 3**: Auth (Firebase Auth or Supabase), multi-user sessions, session history sidebar
- **Phase 4**: Browser automation (Playwright), live price extraction
- **Phase 5**: Checkout execution with confirmation gates, price drop notifications
- **Phase 6**: Mobile PWA or React Native (same backend API)

---

## Key Design Decisions

- **WebSocket over HTTP polling**: real-time token streaming requires a persistent connection
- **Session affinity on Cloud Run**: required for WebSocket connections (one flag in Cloud Run config)
- **Cloud SQL Auth Proxy sidecar**: avoids VPC Connector cost (~$6/mo saved), proxy runs as a sidecar container on Cloud Run
- **Prompt caching on system prompt**: cheap to add now, saves cost as conversations grow
- **Messages stored in role/content shape**: matches Claude API format exactly, no transformation needed when replaying history
- **UUID session IDs**: enables future auth hookup — just add user_id FK to sessions table
