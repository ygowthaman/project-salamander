from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_db
from db.repositories import messages as messages_repo
from db.repositories import sessions as sessions_repo

router = APIRouter()


class CreateSessionRequest(BaseModel):
    title: str | None = None


class SessionResponse(BaseModel):
    id: UUID
    title: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.post("/sessions", response_model=SessionResponse)
async def create_session(body: CreateSessionRequest, db: AsyncSession = Depends(get_db)):
    session = await sessions_repo.create_session(db, title=body.title or "New Session")
    return session


@router.get("/sessions/{session_id}/history", response_model=list[MessageResponse])
async def get_history(session_id: UUID, db: AsyncSession = Depends(get_db)):
    session = await sessions_repo.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return await messages_repo.get_history(db, session_id)
