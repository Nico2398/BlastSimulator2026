"""
Patch ChatDeepSeek to round-trip DeepSeek's reasoning_content field.

DeepSeek thinking models (e.g. deepseek-v4-flash) return `reasoning_content`
in assistant messages. ChatDeepSeek stores it in AIMessage.additional_kwargs
but does not pass it back in subsequent requests, causing DeepSeek to reject
multi-turn conversations with:
  "The reasoning_content in the thinking mode must be passed back to the API."

Fix: override ChatDeepSeek._get_request_payload to inject reasoning_content
from each AIMessage.additional_kwargs into the corresponding outgoing payload.

Safe to load via sitecustomize.py: is a no-op when langchain-deepseek is not
installed (other provider in use) and is idempotent across multiple imports.

See https://github.com/langchain-ai/langchain/issues/34166
"""
try:
    from langchain_core.messages import AIMessage
    from langchain_deepseek import ChatDeepSeek
except ImportError:
    # langchain-deepseek not installed — patch is a no-op (other provider in use)
    pass
else:
    if not getattr(ChatDeepSeek, "_reasoning_content_patched", False):
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
        print("DeepSeek reasoning_content patch applied to ChatDeepSeek._get_request_payload.")
