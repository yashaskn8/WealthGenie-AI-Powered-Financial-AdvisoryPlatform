"""
WealthGenie Open-Weight LLM Platform - Dataset Chat Template Formatter
Formats raw instruction or conversation samples into standard ChatML, Alpaca, or ShareGPT formats.
"""

from typing import Dict, Any


def format_alpaca_template(sample: Dict[str, Any]) -> str:
    """Formats an instruction sample using the Alpaca template."""
    instruction = str(sample.get("instruction", "")).strip()
    input_text = str(sample.get("input", "")).strip()
    output_text = str(sample.get("output", "")).strip()
    system_text = sample.get("system", "Below is an instruction that describes a task. Write a response that appropriately completes the request.")

    if input_text:
        formatted = (
            f"{system_text}\n\n"
            f"### Instruction:\n{instruction}\n\n"
            f"### Input:\n{input_text}\n\n"
            f"### Response:\n{output_text}"
        )
    else:
        formatted = (
            f"{system_text}\n\n"
            f"### Instruction:\n{instruction}\n\n"
            f"### Response:\n{output_text}"
        )
    return formatted


def format_chatml_template(sample: Dict[str, Any]) -> str:
    """Formats a conversation or instruction sample into standard ChatML tags (<|im_start|>...<|im_end|>)."""
    parts = []

    if "messages" in sample:
        for m in sample["messages"]:
            role = m.get("role", "user")
            content = str(m.get("content", "")).strip()
            parts.append(f"<|im_start|>{role}\n{content}<|im_end|>")
    elif "instruction" in sample:
        sys_msg = sample.get("system", "You are WealthGenie AI, a certified financial advisor assistant.")
        inst = str(sample.get("instruction", "")).strip()
        inp = str(sample.get("input", "")).strip()
        out = str(sample.get("output", "")).strip()

        user_content = f"{inst}\n{inp}".strip() if inp else inst

        parts.append(f"<|im_start|>system\n{sys_msg}<|im_end|>")
        parts.append(f"<|im_start|>user\n{user_content}<|im_end|>")
        parts.append(f"<|im_start|>assistant\n{out}<|im_end|>")

    return "\n".join(parts)


def format_sample_to_text(sample: Dict[str, Any], template_style: str = "chatml") -> str:
    """Formats a raw dataset sample into target training prompt text according to requested style."""
    style = template_style.lower()
    if style == "alpaca":
        return format_alpaca_template(sample)
    else:
        # Default ChatML format
        return format_chatml_template(sample)
