# Law Ingestion Toolkit — clause.id

Tambah data hukum Indonesia ke corpus hukum Clause Assistant langsung dari IDE lokal.

Toolkit ini mendukung:
- paste teks langsung
- file `TXT` / `MD`
- file `PDF`
- file `JSON` lengkap
- drop beberapa file `JSON` ke folder lalu ingest sekaligus

Targetnya sederhana: tambah UU baru dalam kurang dari 5 menit.

## File

```text
scripts/laws/
├── README.md
├── add_law.py
├── template.json
└── examples/
    ├── example_paste.txt
    └── example_meta.json
```

## Setup Sekali Saja

Jalankan dari folder backend:

```bash
cd /root/workspace-saas/backend
pip install -r requirements.txt
```

Jika mau ingest dari PDF:

```bash
pip install pdfplumber
```

Pastikan environment ini tersedia:
- `OPENAI_API_KEY`
- `QDRANT_URL` atau Qdrant lokal di `localhost:6333`
- `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` jika ingin update canonical tables juga

Catatan:
- `--dry-run` tetap bisa dipakai walau Qdrant / Supabase belum aktif.
- Qdrant host dideteksi otomatis:
  - dalam Docker: `qdrant`
  - dari host: `localhost`

## Quick Start

### 1. Test parsing dulu

```bash
cd /root/workspace-saas/backend
python3 scripts/laws/add_law.py \
  --file scripts/laws/examples/example_paste.txt \
  --meta scripts/laws/examples/example_meta.json \
  --dry-run
```

### 2. Dari file TXT / Markdown

```bash
python3 scripts/laws/add_law.py --file uu_ite.txt --meta meta.json
```

### 3. Dari PDF

```bash
python3 scripts/laws/add_law.py --pdf uu_ite.pdf --meta meta.json
```

### 4. Paste langsung

```bash
python3 scripts/laws/add_law.py --paste --meta meta.json
```

Jika `EDITOR` tersedia, script akan buka editor dulu. Kalau tidak, script akan baca dari stdin.

### 5. JSON lengkap dalam satu file

Salin template, isi metadata dan `raw_text`, lalu ingest:

```bash
cp scripts/laws/template.json scripts/laws/uu_ite_full.json
python3 scripts/laws/add_law.py --json scripts/laws/uu_ite_full.json
```

### 6. Drop JSON file ke folder lalu ingest sekaligus

Letakkan satu atau lebih file JSON siap ingest di `scripts/laws/`, lalu jalankan:

```bash
python3 scripts/laws/add_law.py --discover
```

Yang discan hanya file `*.json` di `scripts/laws/` top-level.
`template.json` otomatis di-skip.

### 7. Pakai canonical JSON yang sudah ada

Script juga bisa membaca format canonical seperti `data/laws/uu_pdp_27_2022.json`:

```bash
python3 scripts/laws/add_law.py --json data/laws/uu_pdp_27_2022.json --dry-run
```

### 8. Lihat law yang sudah ada di Qdrant

```bash
python3 scripts/laws/add_law.py --list
```

## Format Metadata

Minimal isi:

```json
{
  "short_name": "UU ITE",
  "full_name": "UU No. 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik",
  "law_type": "UU",
  "number": "11",
  "year": 2008,
  "category": "technology"
}
```

Opsional:
- `jurisdiction`
- `effective_date`
- `promulgation_date`
- `official_source_url`

Jika `effective_date` tidak diisi, script akan memakai fallback `YYYY-01-01` untuk `law_versions.effective_from`.

## Kategori Yang Tersedia

- `general`
- `data_protection`
- `technology`
- `labor`
- `commercial`
- `financial_services`
- `consumer_protection`
- `corporate`
- `procurement`
- `language`
- `general_business`

## Law Type Yang Umum

- `UU`
- `PP`
- `POJK`
- `Permendag`
- `Perpres`
- `KUH`
- `SEMA`
- `SE`

`law_type` akan dinormalisasi ke uppercase saat ingest.

## Format Teks Yang Didukung

Script akan mencari pola `Pasal N` sebagai boundary utama.

Contoh minimal:

```text
BAB I
KETENTUAN UMUM

Pasal 1
Dalam Undang-Undang ini yang dimaksud dengan:
1. ...

Pasal 2
...
```

## Yang Diwrite Oleh Script

Jika kredensial tersedia, script akan upsert ke:
- Supabase canonical tables: `laws`, `law_versions`, `structural_nodes`
- Qdrant schema v2 collection aktif / alias aktif

Jika collection legacy `id_national_laws` masih ada, script juga mirror payload legacy ke sana.

## Tips Praktis

- Untuk source teks, paling cepat biasanya dari `peraturan.bpk.go.id` tab teks atau HTML JDIH.
- Jalankan `--dry-run` dulu sebelum ingest beneran.
- Re-ingest law yang sama akan overwrite node dengan ID deterministic yang sama.
- Kalau isi law berubah total dan jumlah pasalnya berkurang, cek ulang data lama yang mungkin masih tersisa.
