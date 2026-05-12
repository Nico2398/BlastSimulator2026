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

Patch 3 — langchain_openai (optional, two sub-patches):
  3a (parse): Preserves reasoning_content in langchain_openai's
  _convert_dict_to_message — required for langchain_core >=1.x where the
  old convert_dict_to_message was removed from langchain_core.messages.utils.
  3b (serialize): Same as Patch 2, applied to langchain_openai's local copy
  of the serialisation helper if present.

Patches 1 and 2 target langchain_core <1.x (backward compat). For newer
versions, the reasoning_content logic is handled entirely by Patch 3.
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
            "Patch 1: anchor not found in langchain_core (likely newer version); "
            "reasoning_content parse will be applied via Patch 3a (langchain_openai)",
            file=sys.stderr,
        )

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
            "Patch 2: anchor not found in langchain_core (likely newer version); "
            "reasoning_content serialization will be applied via Patch 3b (langchain_openai)",
            file=sys.stderr,
        )

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
    cmb_changed = False

    # ---------------------------------------------------------------------------
    # Patch 3a — langchain_openai: _convert_dict_to_message (parse)
    # In langchain_core >=1.x the old convert_dict_to_message was removed;
    # langchain_openai has its own copy where reasoning_content must be preserved.
    # Anchor: the "audio" extraction block just before "return AIMessage(" in the
    # role == "assistant" branch of _convert_dict_to_message.
    # ---------------------------------------------------------------------------
    SENTINEL1B = "# deepseek-reasoning-p1b"
    if SENTINEL1B in cmb_src or SENTINEL1 in cmb_src:
        print("Patch 3a (parse): already applied")
    else:
        _audio_anchor = (
            '        if audio := _dict.get("audio"):\n'
            '            additional_kwargs["audio"] = audio\n'
            '        return AIMessage('
        )
        if _audio_anchor in cmb_src:
            _inject1b = (
                '        if audio := _dict.get("audio"):\n'
                '            additional_kwargs["audio"] = audio\n'
                f'        {SENTINEL1B}\n'
                '        if _dict.get("reasoning_content"):\n'
                '            additional_kwargs["reasoning_content"] = _dict["reasoning_content"]\n'
                '        return AIMessage('
            )
            cmb_src = cmb_src.replace(_audio_anchor, _inject1b, 1)
            cmb_changed = True
            print(f"Patch 3a (parse): applied — reasoning_content preserved in langchain_openai ({cmb_path})")
        else:
            print("Patch 3a (parse): audio anchor not found in langchain_openai — skipping")

    # ---------------------------------------------------------------------------
    # Patch 3b — langchain_openai: _convert_message_to_dict (serialize)
    # Re-include reasoning_content in the outgoing API request dict for DeepSeek.
    # ---------------------------------------------------------------------------
    SENTINEL3 = "# deepseek-reasoning-p3"
    if SENTINEL3 in cmb_src:
        print("Patch 3b (serialize): already applied")
    else:
        m3 = re.search(r'([ \t]+)(elif "function_call" in message\.additional_kwargs:)', cmb_src)
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
            cmb_changed = True
            print(f"Patch 3b (serialize): applied to langchain_openai ({cmb_path})")
        else:
            print("Patch 3b (serialize): anchor not found in langchain_openai — same fix may not be needed there")

    if cmb_changed:
        open(cmb_path, "w").write(cmb_src)
        print(f"Written: {cmb_path}")
except Exception as e:
    print(f"Patch 3: skipped (failed to import/patch langchain_openai: {e})")

print("=== Patch complete ===")
