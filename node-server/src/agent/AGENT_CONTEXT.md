# Agent Context

This is the LLM layer of the backend. It is intentionally isolated from routing and database concerns — its only job is to talk to Claude and stream the response back to the caller.

## Responsibility

`index.ts` owns two things:

- The **system prompt** — defines the shopping assistant persona and behaviour. Isolated here so it can be tuned without touching any other layer.
- The **streaming function** — takes a conversation history and yields Claude's response as text chunks, one at a time.

## SDK

The Anthropic TypeScript SDK (`@anthropic-ai/sdk`) is used to communicate with Claude. It handles authentication via `ANTHROPIC_API_KEY` from the environment, request formatting, and the streaming protocol.

## Streaming

Rather than waiting for Claude to finish generating a full response, the SDK streams it incrementally. The agent exposes this as an async generator — each chunk of text is yielded as soon as it arrives, so the WebSocket layer can forward it to the browser in real time.

Filtering is on `content_block_delta` events with a `text_delta` delta, so thinking blocks or other block types (should they be enabled later) will not leak into the user-visible stream.

## Prompt caching

`cache_control: { type: "ephemeral" }` is set on the system prompt block. Because the system prompt is byte-identical on every request, the API can cache that prefix and skip reprocessing it.

**Caveat worth knowing:** the current system prompt is only ~60 tokens, well under the minimum cacheable prefix (1024–4096 tokens depending on model). Caching therefore will not actually engage yet — `usage.cache_read_input_tokens` will be `0`. The `cache_control` marker is in place so that caching starts working automatically once the prompt grows, at no cost today. Do not interpret zero cache reads as a bug until the prompt is over the minimum.

## Sync vs async client

The Python implementation used the synchronous `Anthropic()` client inside an async function, which blocked the event loop under concurrent load; migrating to `AsyncAnthropic()` was a known outstanding fix. That problem does not exist here — the JS/TS SDK is async and non-blocking by construction, so the issue was resolved by the platform switch rather than by a code change.

## Dependencies and consumers

This folder has no dependency on the database or API layers — only the Anthropic SDK.

It is consumed exclusively by `api/websocket.ts`, which orchestrates the full message flow: loading history, saving messages, and forwarding streamed tokens to the client. See `../api/API_CONTEXT.md` for that layer.
