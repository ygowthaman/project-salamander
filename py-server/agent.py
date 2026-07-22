import anthropic

SYSTEM_PROMPT = """You are a helpful shopping assistant. When a user describes what they want to buy, \
ask clarifying questions if needed, then provide specific product suggestions with reasoning. \
Include estimated price ranges, key features to look for, and trade-offs between options. \
Be concise and practical."""

client = anthropic.Anthropic()

async def stream_response(messages: list[dict]) -> None:
    with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield text