"""
Pariana Backend - Utility Functions
Shared helpers used across services and routers.
"""
import re


def chunk_text(text: str, chunk_size: int = 1500, overlap: int = 200) -> list[str]:
    """
    Recursively chunks legal text while preserving the [Page X] markers.
    
    The overlap (default 200 chars) prevents legal clauses from being 
    cut in half during semantic search. If a clause spans positions 
    1400-1600, both Chunk A (0-1500) and Chunk B (1300-2800) will 
    contain the full clause, ensuring it always appears in at least 
    one vector's payload.
    """
    chunks = []
    current_page = "[Page 1]"
    i = 0
    while i < len(text):
        page_marks = re.findall(r'\[Page \d+\]', text[:i + 50])
        if page_marks:
            current_page = page_marks[-1]

        chunk_end = min(i + chunk_size, len(text))

        # Try to break at a newline to avoid splitting mid-sentence
        if chunk_end < len(text):
            last_newline = text.rfind('\n', i, chunk_end)
            if last_newline != -1 and last_newline > i + (chunk_size // 2):
                chunk_end = last_newline + 1

        raw_chunk = text[i:chunk_end].strip()

        # Ensure page marker is preserved
        if not re.search(r'\[Page \d+\]', raw_chunk):
            raw_chunk = current_page + " " + raw_chunk

        chunks.append(raw_chunk)

        if chunk_end == len(text):
            break

        i = chunk_end - overlap

    return chunks
