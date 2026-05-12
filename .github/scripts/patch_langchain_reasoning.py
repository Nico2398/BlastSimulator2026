"""
Patch LangChain to round-trip DeepSeek's reasoning_content field.

DeepSeek thinking models (e.g. deepseek-v4-flash) return `reasoning_content`
in assistant messages. LangChain drops this field when serializing message
history, causing DeepSeek to reject multi-turn conversations with:
  "The reasoning_content in the thinking mode must be passed back to the API."

Patch 1 — convert_dict_to_message (langchain_core):
  Preserves reasoning_content from the API response into
  AIMessage.additional_kwargs.

Patch 2 — convert_message_to_dict (langchain_core):
  Re-injects reasoning_content from AIMessage.additional_kwargs into the
  outgoing API request — but ONLY when LLM_MODEL_ID contains "deepseek".
  This prevents reasoning_content accumulated from a prior DeepSeek session
  from being forwarded to a different provider's API when the model is
  switched.

Patch 3 — langchain_openai (optional):
  Same as Patch 2, applied to langchain_openai's local copy of the
  serialisation helper if present.

Patches are idempotent (sentinel comments guard re-application) and
resilient across langchain versions (regex-anchored insertion).
"""
import inspect
import os
import re
import sys

print("=== DeepSeek reasoning_content patch ===")


def detect_indent_unit(text: str) -> str:
    """Return the smallest indent unit found in *text* (tab or N spaces)."""
    if re.search(r"^\t", text, re.MULTILINE):
        return "\t"
    widths = [
        len(m.group())
        for m in re.finditer(r"^ +(?=\S)", text, re.MULTILINE)
        if m.group()
    ]
    return " " * min(widths) if widths else "    "


import langchain_core.messages.utils as mu  # noqa: E402

path = inspect.getfile(mu)
src = open(path).read()
print(f"File: {path}")
changed = False

indent_unit = detect_indent_unit(src)

# ---------------------------------------------------------------------------
# Patch 1 — convert_dict_to_message
# Store reasoning_content into AIMessage.additional_kwargs when parsing the
# API response so it is available for later turns.
# ---------------------------------------------------------------------------
SENTINEL1 = "# deepseek-reasoning-p1"
if SENTINEL1 in src:
    print("Patch 1: already applied")
else:
    m = re.search(r"([ \t]+)(additional_kwargs\s*:\s*Dict\s*=\s*\{\})", src)
    if m:
        indent = m.group(1)
        child = indent + indent_unit
        inject = (
            f"\n{indent}{SENTINEL1}\n"
            f"{indent}if _dict.get(\"reasoning_content\"):\n"
            f"{child}additional_kwargs[\"reasoning_content\"] = _dict[\"reasoning_content\"]\n"
        )
        end = m.end()
        src = src[:end] + inject + src[end:]
        changed = True
        print("Patch 1: applied — reasoning_content preserved in convert_dict_to_message")
    else:
        print(
            "Patch 1: FATAL — anchor"
            r" r'([ \t]+)(additional_kwargs\s*:\s*Dict\s*=\s*\{\})'"
            f" not found in {path}; cannot apply DeepSeek reasoning_content fix",
            file=sys.stderr,
        )
        sys.exit(1)

# ---------------------------------------------------------------------------
# Patch 2 — convert_message_to_dict
# Re-include reasoning_content in the outgoing API request dict, but only
# when the active model is a DeepSeek model (LLM_MODEL_ID contains
# "deepseek").  This guard prevents reasoning_content that was stored during
# a DeepSeek session from being forwarded to a different provider's API when
# the model is later switched.
# ---------------------------------------------------------------------------
SENTINEL2 = "# deepseek-reasoning-p2"
if SENTINEL2 in src:
    print("Patch 2: already applied")
else:
    m2 = re.search(r'([ \t]+)(if "function_call" in message\.additional_kwargs:)', src)
    if m2:
        indent2 = m2.group(1)
        child2 = indent2 + indent_unit
        inject2 = (
            f"{indent2}{SENTINEL2}\n"
            f"{indent2}import os as _os_rc\n"
            f"{indent2}if (\n"
            f'{child2}"reasoning_content" in message.additional_kwargs\n'
            f'{child2}and "deepseek" in _os_rc.getenv("LLM_MODEL_ID", "").lower()\n'
            f"{indent2}):\n"
            f'{child2}message_dict["reasoning_content"] = message.additional_kwargs["reasoning_content"]\n'
        )
        start2 = m2.start()
        src = src[:start2] + inject2 + src[start2:]
        changed = True
        print("Patch 2: applied — reasoning_content re-injected in convert_message_to_dict (DeepSeek only)")
    else:
        print(
            "Patch 2: FATAL — anchor"
            r' r\'([ \t]+)(if "function_call" in message\.additional_kwargs:)\''
            f" not found in {path}; cannot apply DeepSeek reasoning_content fix",
            file=sys.stderr,
        )
        sys.exit(1)

if changed:
    open(path, "w").write(src)
    print(f"Written: {path}")

# ---------------------------------------------------------------------------
# Patch 3 — langchain_openai (may import convert_message_to_dict locally)
# Same guard as Patch 2.
# ---------------------------------------------------------------------------
try:
    import langchain_openai.chat_models.base as cmb  # noqa: E402

    cmb_path = inspect.getfile(cmb)
    cmb_src = open(cmb_path).read()
    cmb_indent_unit = detect_indent_unit(cmb_src)
    SENTINEL3 = "# deepseek-reasoning-p3"
    if SENTINEL3 in cmb_src:
        print("Patch 3: already applied")
    else:
        m3 = re.search(r'([ \t]+)(if "function_call" in message\.additional_kwargs:)', cmb_src)
        if m3:
            indent3 = m3.group(1)
            child3 = indent3 + cmb_indent_unit
            inject3 = (
                f"{indent3}{SENTINEL3}\n"
                f"{indent3}import os as _os_rc\n"
                f"{indent3}if (\n"
                f'{child3}"reasoning_content" in message.additional_kwargs\n'
                f'{child3}and "deepseek" in _os_rc.getenv("LLM_MODEL_ID", "").lower()\n'
                f"{indent3}):\n"
                f'{child3}message_dict["reasoning_content"] = message.additional_kwargs["reasoning_content"]\n'
            )
            start3 = m3.start()
            cmb_src = cmb_src[:start3] + inject3 + cmb_src[start3:]
            open(cmb_path, "w").write(cmb_src)
            print(f"Patch 3: applied to langchain_openai ({cmb_path})")
        else:
            print("Patch 3: anchor not found in langchain_openai — same fix may not be needed there")
except Exception as e:
    print(f"Patch 3: skipped (failed to import/patch langchain_openai: {e})")

print("=== Patch complete ===")
