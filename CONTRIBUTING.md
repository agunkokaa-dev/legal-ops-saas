## Code Style Warning

Do NOT use markdown link syntax inside TypeScript/TSX files.
Some editors or AI tools may corrupt method calls like:

- `documents.map(...)` -> markdown-link text wrapping `documents.map`
- `doc.id` -> markdown-link text wrapping `doc.id`

Always verify files with:

```bash
npm run check:markdown-corruption
```
