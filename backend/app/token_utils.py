import tiktoken
import logging

logger = logging.getLogger(__name__)

def count_tokens(text: str, model_name: str = "gpt-4o") -> int:
    """Returns the exact token count for a given text."""
    if not text:
        return 0
    try:
        encoding = tiktoken.encoding_for_model(model_name)
    except KeyError:
        encoding = tiktoken.get_encoding("o200k_base") # Fallback
    return len(encoding.encode(text))

def truncate_to_tokens(text: str, max_tokens: int, model_name: str = "gpt-4o", add_warning: bool = True) -> tuple[str, bool]:
    """
    Truncates a string to a maximum number of tokens safely.
    Returns (truncated_text, was_truncated_boolean).
    """
    if not text:
        return "", False

    try:
        encoding = tiktoken.encoding_for_model(model_name)
    except KeyError:
        encoding = tiktoken.get_encoding("o200k_base")
        
    tokens = encoding.encode(text)
    if len(tokens) <= max_tokens:
        return text, False
        
    truncated_tokens = tokens[:max_tokens]
    truncated_text = encoding.decode(truncated_tokens)
    
    if add_warning:
        warning_msg = "\n\n[SYSTEM WARNING: DOCUMENT TRUNCATED DUE TO AI CONTEXT LIMITS. CLAUSES BEYOND THIS POINT WERE NOT ANALYZED.]"
        truncated_text += warning_msg
        
    logger.warning(f"Text truncated from {len(tokens)} to {max_tokens} tokens.")
    return truncated_text, True
