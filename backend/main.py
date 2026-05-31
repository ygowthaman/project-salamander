import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.sessions import router as sessions_router
from api.websocket import router as websocket_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)
app.include_router(websocket_router)
