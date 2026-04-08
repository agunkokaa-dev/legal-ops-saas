from app.token_budget import count_tokens as _count_tokens
from app.token_budget import truncate_to_budget


def count_tokens(text: str, model_name: str = "gpt-4o") -> int:
    return _count_tokens(text, model_name)


def truncate_to_tokens(
    text: str,
    max_tokens: int,
    model_name: str = "gpt-4o",
    add_warning: bool = True,
) -> tuple[str, bool]:
    strategy = "tail_preserve" if add_warning else "simple"
    truncated_text, was_truncated, _ = truncate_to_budget(
        text,
        max_tokens=max_tokens,
        model=model_name,
        strategy=strategy,
    )
    return truncated_text, was_truncated
