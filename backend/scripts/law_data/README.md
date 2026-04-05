# Indonesian National Law PDFs — Data Directory

This directory holds official legal PDFs downloaded from Indonesian government JDIH sources.
These are ingested by `../ingest_national_laws.py` into the `id_national_laws` Qdrant collection.

## Required PDFs

| Filename | Law | Official URL |
|----------|-----|-------------|
| `uu_6_2023_cipta_kerja.pdf` | UU No. 6 Tahun 2023 — Cipta Kerja | https://peraturan.bpk.go.id/Details/246523/uu-no-6-tahun-2023 |
| `pp_35_2021_pkwt.pdf` | PP No. 35 Tahun 2021 — PKWT/Outsourcing | https://peraturan.bpk.go.id/Details/161798/pp-no-35-tahun-2021 |
| `uu_27_2022_pdp.pdf` | UU No. 27 Tahun 2022 — PDP (Data Protection) | https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022 |
| `uu_24_2009_bahasa.pdf` | UU No. 24 Tahun 2009 — Bahasa | https://peraturan.bpk.go.id/Details/38783/uu-no-24-tahun-2009 |
| `pojk_11_2022_it_bank.pdf` | POJK 11/2022 — IT for Banks | https://ojk.go.id |
| `pojk_6_2022_consumer.pdf` | POJK 6/2022 — Consumer Protection | https://ojk.go.id |
| `pojk_4_2025_aggregator.pdf` | POJK 4/2025 — Financial Aggregators | https://ojk.go.id |

## Instructions

1. Download each PDF from the official URL above
2. Save with the exact filename listed in the table
3. Run: `python -m backend.scripts.ingest_national_laws --law <key>`

## Notes

- **CRITICAL**: Only use official JDIH sources. No blog posts or AI paraphrases.
- The `--manual-only` flag works without any PDFs (uses curated entries hardcoded in the script).
- PDFs are `.gitignore`d — they contain copyrighted government publications.
