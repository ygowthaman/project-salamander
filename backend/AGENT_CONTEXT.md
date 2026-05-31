# Agent Context

This file is the LLM layer of the backend. It is intentionally isolated from routing and database concerns — its only job is to communicate with Claude and stream the response back to the caller.

## Responsibility

`agent.py` owns two things:
- The **system prompt** — defines the shopping assistant persona and behaviour. Isolated here so it can be tuned without touching any other layer.
- The **streaming function** — takes a conversation history and streams Claude's response back as text chunks, one at a time.

## SDK

The Anthropic Python SDK (`anthropic` package) is used to communicate with Claude. It handles authentication via `ANTHROPIC_API_KEY` from the environment, request formatting, and the streaming protocol.

## Streaming

Rather than waiting for Claude to finish generating a full response and returning it all at once, the SDK streams the response incrementally. The agent exposes this as an async generator — each chunk of text is yielded as soon as it arrives from the API, allowing the WebSocket layer to forward it to the browser in real time.

## Prompt Caching

Prompt caching is applied to the system prompt. Because the system prompt is identical on every request, the API can cache it and avoid reprocessing it each time — reducing latency and cost as conversation history grows.

## Sync vs Async Client

The SDK offers two clients: `anthropic.Anthropic()` (synchronous) and `anthropic.AsyncAnthropic()` (async). The current implementation uses the synchronous client inside an async function, which works in development but blocks the event loop under concurrent load. Migrating to `AsyncAnthropic()` with `async with` / `async for` is the correct approach for production.

## Dependencies and Consumers

`agent.py` has no dependencies on the database or API layers. It only depends on the Anthropic SDK.

It is consumed exclusively by `api/websocket.py`, which is the only layer that orchestrates the full message flow — loading history, saving messages, and forwarding streamed tokens to the client. See `api/API_CONTEXT.md` for that layer.
