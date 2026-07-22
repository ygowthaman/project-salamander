import json
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent import stream_response
from db.engine import AsyncSessionFactory
from db.repositories import messages as messages_repo
from db.repositories import sessions as sessions_repo

router = APIRouter()


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: UUID):
    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_text()
            user_message = json.loads(data)["message"]

            async with AsyncSessionFactory() as db:
                session = await sessions_repo.get_session(db, session_id)
                if not session:
                    await websocket.send_text(json.dumps({"type": "error", "message": "Session not found"}))
                    continue

                history = await messages_repo.get_history(db, session_id)
                await messages_repo.save_message(db, session_id, "user", user_message)

            messages = [{"role": m.role, "content": m.content} for m in history]
            messages.append({"role": "user", "content": user_message})

            full_response = ""
            async for chunk in stream_response(messages):
                full_response += chunk
                await websocket.send_text(json.dumps({"type": "chunk", "text": chunk}))

            async with AsyncSessionFactory() as db:
                await messages_repo.save_message(db, session_id, "assistant", full_response)

            await websocket.send_text(json.dumps({"type": "done"}))

    except WebSocketDisconnect:
        pass
