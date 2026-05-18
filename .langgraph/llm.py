"""LLM factory for the BlastSimulator2026 LangGraph pipeline.

Parses LLM_MODEL_ID env var (format: 'provider:model-name') and returns
the appropriate LangChain ChatModel instance.

Supported providers:
  deepseek:   uses langchain-deepseek (ChatDeepSeek) + reasoning_content patch
  openai:     uses langchain-openai (ChatOpenAI)
  anthropic:  uses langchain-anthropic (ChatAnthropic)

Examples:
  LLM_MODEL_ID=deepseek:deepseek-v4-flash
  LLM_MODEL_ID=openai:gpt-4o
  LLM_MODEL_ID=anthropic:claude-3-7-sonnet-20250219
"""

import os


def build_llm(model_id: str | None = None):
    """Return a LangChain ChatModel for the given model ID.

    Args:
        model_id: 'provider:model-name' string. Defaults to LLM_MODEL_ID env var.

    Returns:
        A LangChain BaseChatModel instance ready for use.

    Raises:
        ValueError: If the provider prefix is unknown or model_id is missing.
    """
    if model_id is None:
        model_id = os.environ.get("LLM_MODEL_ID", "deepseek:deepseek-v4-flash")

    if ":" not in model_id:
        raise ValueError(
            f"LLM_MODEL_ID must be 'provider:model-name', got: {model_id!r}"
        )

    provider, model_name = model_id.split(":", 1)

    match provider:
        case "deepseek":
            return _build_deepseek(model_name)
        case "openai":
            return _build_openai(model_name)
        case "anthropic":
            return _build_anthropic(model_name)
        case _:
            raise ValueError(
                f"Unknown LLM provider: {provider!r}. "
                "Supported: deepseek, openai, anthropic"
            )


def _build_deepseek(model_name: str):
    """Build a ChatDeepSeek instance with the reasoning_content patch applied."""
    try:
        from langchain_deepseek import ChatDeepSeek
    except ImportError as exc:
        raise ImportError(
            "langchain-deepseek not installed. "
            "Run: uv add langchain-deepseek"
        ) from exc

    _apply_deepseek_patch()

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        raise ValueError("DEEPSEEK_API_KEY environment variable is not set")

    return ChatDeepSeek(model=model_name, api_key=api_key)


def _build_openai(model_name: str):
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:
        raise ImportError(
            "langchain-openai not installed. "
            "Run: uv add langchain-openai"
        ) from exc

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    return ChatOpenAI(model=model_name, api_key=api_key)


def _build_anthropic(model_name: str):
    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError as exc:
        raise ImportError(
            "langchain-anthropic not installed. "
            "Run: uv add langchain-anthropic"
        ) from exc

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

    return ChatAnthropic(model=model_name, api_key=api_key)


def _apply_deepseek_patch() -> None:
    """Apply the reasoning_content round-trip patch to ChatDeepSeek.

    DeepSeek thinking models return reasoning_content in assistant messages.
    Without this patch, multi-turn tool calls fail with:
      'The reasoning_content in the thinking mode must be passed back to the API.'

    This patch is idempotent — safe to call multiple times.
    See: https://github.com/langchain-ai/langchain/issues/34166
    """
    try:
        from langchain_core.messages import AIMessage
        from langchain_deepseek import ChatDeepSeek
    except ImportError:
        return  # Other provider — patch is a no-op

    if getattr(ChatDeepSeek, "_reasoning_content_patched", False):
        return  # Already patched

    _orig = ChatDeepSeek._get_request_payload

    def _patched(self, input_, *, stop=None, **kwargs):
        payload = _orig(self, input_, stop=stop, **kwargs)
        messages = self._convert_input(input_).to_messages()
        for i, msg in enumerate(payload["messages"]):
            if (
                msg["role"] == "assistant"
                and i < len(messages)
                and isinstance(messages[i], AIMessage)
            ):
                rc = messages[i].additional_kwargs.get("reasoning_content")
                if rc is not None:
                    msg["reasoning_content"] = rc
        return payload

    ChatDeepSeek._get_request_payload = _patched
    ChatDeepSeek._reasoning_content_patched = True
