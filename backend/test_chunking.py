import re

def chunk_text(text: str, chunk_size: int = 1500, overlap: int = 200) -> list[str]:
    chunks = []
    
    current_page = "[Page 1]"
    i = 0
    while i < len(text):
        page_marks = re.findall(r'\[Page \d+\]', text[:i + 50])
        if page_marks:
            current_page = page_marks[-1]
            
        chunk_end = min(i + chunk_size, len(text))
        
        if chunk_end < len(text):
            last_newline = text.rfind('\n', i, chunk_end)
            if last_newline != -1 and last_newline > i + (chunk_size // 2):
                 chunk_end = last_newline + 1
                 
        raw_chunk = text[i:chunk_end].strip()
        
        if not re.search(r'\[Page \d+\]', raw_chunk):
            raw_chunk = current_page + " " + raw_chunk
            
        chunks.append(raw_chunk)
        
        if chunk_end == len(text):
            break
            
        i = chunk_end - overlap

    return chunks

text = """[Page 1] This is the first page. It has some text.
And some more text here.
[Page 2] This is the second page. We want to chunk this.
It needs to be split up. More text to make it longer so we can test the chunking overlap logic properly.
Because this needs to span across multiple chunks to see if [Page 2] is preserved.
Even more text."""

print(len(chunk_text(text, chunk_size=100, overlap=20)))
for idx, c in enumerate(chunk_text(text, chunk_size=100, overlap=20)):
    print(f"--- Chunk {idx} ---")
    print(c)

