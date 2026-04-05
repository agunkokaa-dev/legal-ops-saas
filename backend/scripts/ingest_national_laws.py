"""
Pariana Backend — Indonesian National Law Ingestion Pipeline

Populates the `id_national_laws` Qdrant collection with pasal-level chunks
from official Indonesian legal texts. This is a GLOBAL corpus (no tenant isolation).

Usage:
    cd /root/workspace-saas
    python -m backend.scripts.ingest_national_laws --manual-only
    python -m backend.scripts.ingest_national_laws --law uu_pdp
    python -m backend.scripts.ingest_national_laws
    python -m backend.scripts.ingest_national_laws --law uu_pdp --force
"""
import os
import re
import sys
import uuid
import argparse
from typing import List, Dict, Any

from dotenv import load_dotenv

# Load env from backend/.env
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(env_path)

from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance, VectorParams, PointStruct, PayloadSchemaType,
    Filter, FieldCondition, MatchValue,
)
from openai import OpenAI

# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------
qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
qdrant_client = QdrantClient(url=qdrant_url)
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

COLLECTION = "id_national_laws"
EMBED_MODEL = "text-embedding-3-small"
BATCH_SIZE = 50

# ---------------------------------------------------------------------------
# Embedding helper
# ---------------------------------------------------------------------------
def get_embedding(text: str) -> list[float]:
    truncated = text[:8000]
    resp = openai_client.embeddings.create(input=truncated, model=EMBED_MODEL)
    return resp.data[0].embedding


# ---------------------------------------------------------------------------
# Collection bootstrap
# ---------------------------------------------------------------------------
def ensure_collection():
    existing = [c.name for c in qdrant_client.get_collections().collections]
    if COLLECTION not in existing:
        print(f"[QDRANT] Creating collection: {COLLECTION}")
        qdrant_client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
        )
        for field, schema in [
            ("source_law_short", PayloadSchemaType.KEYWORD),
            ("category", PayloadSchemaType.KEYWORD),
            ("is_active", PayloadSchemaType.BOOL),
        ]:
            qdrant_client.create_payload_index(
                collection_name=COLLECTION,
                field_name=field,
                field_schema=schema,
            )
        print(f"[QDRANT] Collection '{COLLECTION}' created with indexes.")
    else:
        print(f"[QDRANT] Collection '{COLLECTION}' already exists.")


# ---------------------------------------------------------------------------
# Manual curated entries — guaranteed minimum corpus
# ---------------------------------------------------------------------------
def get_manual_entries() -> List[Dict[str, Any]]:
    """
    Hand-curated key provisions for the most commonly cited Indonesian law
    articles in CLM contract review. These ensure the RAG corpus works even
    without PDF extraction.
    """
    entries = [
        # ── UU 24/2009 — Bahasa (Language) ──
        {
            "source_law": "UU No. 24 Tahun 2009 tentang Bendera, Bahasa, dan Lambang Negara, serta Lagu Kebangsaan",
            "source_law_short": "UU 24/2009",
            "category": "bahasa",
            "bab": "III",
            "bab_title": "Bahasa Negara",
            "pasal": "31",
            "text": (
                "Pasal 31\n"
                "(1) Bahasa Indonesia wajib digunakan dalam nota kesepahaman atau perjanjian "
                "yang melibatkan lembaga negara, instansi pemerintah Republik Indonesia, "
                "lembaga swasta Indonesia atau perseorangan warga negara Indonesia.\n"
                "(2) Nota kesepahaman atau perjanjian sebagaimana dimaksud pada ayat (1) yang "
                "melibatkan pihak asing ditulis juga dalam bahasa nasional pihak asing tersebut "
                "dan/atau bahasa Inggris."
            ),
            "effective_date": "2009-07-09",
            "is_active": True,
        },
        {
            "source_law": "UU No. 24 Tahun 2009 tentang Bendera, Bahasa, dan Lambang Negara, serta Lagu Kebangsaan",
            "source_law_short": "UU 24/2009",
            "category": "bahasa",
            "bab": "III",
            "bab_title": "Bahasa Negara",
            "pasal": "33",
            "text": (
                "Pasal 33\n"
                "(1) Bahasa Indonesia wajib digunakan dalam komunikasi resmi di lingkungan kerja "
                "pemerintah dan swasta.\n"
                "(2) Pegawai di lingkungan kerja lembaga swasta sebagaimana dimaksud pada ayat (1) "
                "yang menggunakan bahasa asing diberi pelatihan berbahasa Indonesia."
            ),
            "effective_date": "2009-07-09",
            "is_active": True,
        },
        # ── SEMA 3/2023 — Bad faith requirement ──
        {
            "source_law": "Surat Edaran Mahkamah Agung No. 3 Tahun 2023 tentang Pemberlakuan Rumusan Hasil Rapat Pleno Kamar",
            "source_law_short": "SEMA 3/2023",
            "category": "bahasa",
            "bab": "",
            "bab_title": "Rumusan Kamar Perdata",
            "pasal": "Angka 1-3",
            "text": (
                "SEMA 3/2023 Rumusan Kamar Perdata:\n"
                "1. Perjanjian yang dibuat hanya dalam bahasa asing tanpa versi bahasa Indonesia "
                "sebagaimana disyaratkan Pasal 31 ayat (1) UU 24/2009 tidak secara otomatis batal demi hukum.\n"
                "2. Perjanjian tersebut hanya dapat dibatalkan apabila salah satu pihak mengajukan "
                "pembatalan dan dapat dibuktikan adanya itikad tidak baik (bad faith) dari pihak "
                "yang membuat perjanjian hanya dalam bahasa asing.\n"
                "3. Beban pembuktian itikad tidak baik ada pada pihak yang mengajukan pembatalan."
            ),
            "effective_date": "2023-11-29",
            "is_active": True,
        },
        # ── UU 27/2022 — PDP (Data Protection) ──
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "II",
            "bab_title": "Jenis Data Pribadi",
            "pasal": "4",
            "text": (
                "Pasal 4\n"
                "(1) Data Pribadi terdiri atas:\n"
                "a. Data Pribadi yang bersifat spesifik; dan\n"
                "b. Data Pribadi yang bersifat umum.\n"
                "(2) Data Pribadi yang bersifat spesifik sebagaimana dimaksud pada ayat (1) huruf a meliputi:\n"
                "a. data dan informasi kesehatan;\n"
                "b. data biometrik;\n"
                "c. data genetika;\n"
                "d. catatan kejahatan;\n"
                "e. data anak;\n"
                "f. data keuangan pribadi; dan/atau\n"
                "g. data lainnya sesuai dengan ketentuan peraturan perundang-undangan.\n"
                "(3) Data Pribadi yang bersifat umum sebagaimana dimaksud pada ayat (1) huruf b meliputi:\n"
                "a. nama lengkap;\n"
                "b. jenis kelamin;\n"
                "c. kewarganegaraan;\n"
                "d. agama;\n"
                "e. status perkawinan; dan/atau\n"
                "f. Data Pribadi yang dikombinasikan untuk mengidentifikasi seseorang."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "IV",
            "bab_title": "Pemrosesan Data Pribadi",
            "pasal": "16",
            "text": (
                "Pasal 16\n"
                "(1) Pemrosesan Data Pribadi meliputi:\n"
                "a. pemerolehan dan pengumpulan;\n"
                "b. pengolahan dan penganalisisan;\n"
                "c. penyimpanan;\n"
                "d. perbaikan dan pembaruan;\n"
                "e. penampilan, pengumuman, transfer, penyebarluasan, atau pengungkapan; dan/atau\n"
                "f. penghapusan atau pemusnahan.\n"
                "(2) Pemrosesan Data Pribadi dilakukan sesuai dengan prinsip Pelindungan Data Pribadi meliputi:\n"
                "a. pengumpulan Data Pribadi dilakukan secara terbatas dan spesifik, sah secara hukum, dan transparan;\n"
                "b. pemrosesan Data Pribadi dilakukan sesuai dengan tujuannya;\n"
                "c. pemrosesan Data Pribadi dilakukan dengan menjamin hak Subjek Data Pribadi;\n"
                "d. pemrosesan Data Pribadi dilakukan secara akurat, lengkap, tidak menyesatkan, mutakhir, dan dapat dipertanggungjawabkan;\n"
                "e. pemrosesan Data Pribadi dilakukan dengan melindungi keamanan Data Pribadi dari pengaksesan yang tidak sah;\n"
                "f. pemrosesan Data Pribadi dilakukan dengan memberitahukan tujuan dan aktivitas pemrosesan, serta kegagalan Pelindungan Data Pribadi;\n"
                "g. Data Pribadi dimusnahkan dan/atau dihapus setelah masa retensi berakhir atau berdasarkan permintaan Subjek Data Pribadi;\n"
                "h. pemrosesan Data Pribadi dilakukan secara bertanggung jawab dan dapat dibuktikan secara jelas."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "IV",
            "bab_title": "Pemrosesan Data Pribadi",
            "pasal": "24",
            "text": (
                "Pasal 24\n"
                "Persetujuan sebagaimana dimaksud dalam Pasal 20 ayat (2) huruf a harus memenuhi ketentuan:\n"
                "a. dinyatakan secara tegas, bukan tersirat;\n"
                "b. diminta terlebih dahulu sebelum pemrosesan dilakukan;\n"
                "c. dinyatakan dalam format yang dapat dipahami secara lengkap dan jelas;\n"
                "d. dapat ditarik kembali setelah diberikan; dan\n"
                "e. dalam hal terdapat perubahan tujuan pemrosesan Data Pribadi, Pengendali Data Pribadi "
                "wajib meminta persetujuan kembali kepada Subjek Data Pribadi."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "VIII",
            "bab_title": "Keamanan Data Pribadi",
            "pasal": "40",
            "text": (
                "Pasal 40\n"
                "(1) Dalam hal terjadi kegagalan Pelindungan Data Pribadi, Pengendali Data Pribadi "
                "wajib pemberitahuan secara tertulis paling lambat 3 x 24 (tiga kali dua puluh empat) jam "
                "kepada Subjek Data Pribadi dan lembaga.\n"
                "(2) Pemberitahuan tertulis sebagaimana dimaksud pada ayat (1) minimal memuat:\n"
                "a. Data Pribadi yang terungkap;\n"
                "b. kapan dan bagaimana Data Pribadi terungkap;\n"
                "c. upaya penanganan dan pemulihan atas terungkapnya Data Pribadi oleh Pengendali Data Pribadi."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "IX",
            "bab_title": "Transfer Data Pribadi",
            "pasal": "56",
            "text": (
                "Pasal 56\n"
                "(1) Pengendali Data Pribadi dapat melakukan transfer Data Pribadi kepada Pengendali "
                "Data Pribadi dan/atau Prosesor Data Pribadi di luar wilayah hukum Negara Republik Indonesia.\n"
                "(2) Transfer Data Pribadi sebagaimana dimaksud pada ayat (1) hanya dapat dilakukan apabila:\n"
                "a. negara tujuan transfer memiliki tingkat Pelindungan Data Pribadi yang setara atau "
                "lebih tinggi dari yang diatur dalam Undang-Undang ini;\n"
                "b. terdapat Pelindungan Data Pribadi yang memadai dan bersifat mengikat antarpengendali "
                "Data Pribadi dan/atau Prosesor Data Pribadi; dan/atau\n"
                "c. terdapat persetujuan Subjek Data Pribadi untuk transfer Data Pribadi ke luar negeri."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "XIV",
            "bab_title": "Ketentuan Pidana",
            "pasal": "67",
            "text": (
                "Pasal 67\n"
                "(1) Setiap Orang yang dengan sengaja dan melawan hukum memperoleh atau mengumpulkan "
                "Data Pribadi yang bukan miliknya dengan maksud untuk menguntungkan diri sendiri atau "
                "orang lain yang dapat mengakibatkan kerugian Subjek Data Pribadi sebagaimana dimaksud "
                "dalam Pasal 65 ayat (1) dipidana dengan pidana penjara paling lama 5 (lima) tahun "
                "dan/atau pidana denda paling banyak Rp5.000.000.000,00 (lima miliar rupiah).\n"
                "(2) Setiap Orang yang dengan sengaja dan melawan hukum mengungkapkan Data Pribadi yang "
                "bukan miliknya sebagaimana dimaksud dalam Pasal 65 ayat (2) dipidana dengan pidana penjara "
                "paling lama 4 (empat) tahun dan/atau pidana denda paling banyak Rp4.000.000.000,00 "
                "(empat miliar rupiah)."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "XIV",
            "bab_title": "Ketentuan Pidana",
            "pasal": "68",
            "text": (
                "Pasal 68\n"
                "Setiap Orang yang dengan sengaja dan melawan hukum menggunakan Data Pribadi yang "
                "bukan miliknya sebagaimana dimaksud dalam Pasal 65 ayat (3) dipidana dengan pidana "
                "penjara paling lama 5 (lima) tahun dan/atau pidana denda paling banyak "
                "Rp5.000.000.000,00 (lima miliar rupiah)."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "XIII",
            "bab_title": "Sanksi Administratif",
            "pasal": "57",
            "text": (
                "Pasal 57\n"
                "(1) Penjatuhan Sanksi Administratif sebagaimana dimaksud dalam Pasal 56 "
                "diberikan oleh lembaga.\n"
                "(2) Sanksi administratif sebagaimana dimaksud pada ayat (1) berupa:\n"
                "a. peringatan tertulis;\n"
                "b. penghentian sementara kegiatan pemrosesan Data Pribadi;\n"
                "c. penghapusan atau pemusnahan Data Pribadi; dan/atau\n"
                "d. denda administratif.\n"
                "(3) Denda administratif sebagaimana dimaksud pada ayat (2) huruf d paling tinggi "
                "2% (dua persen) dari pendapatan tahunan atau penerimaan tahunan terhadap variabel "
                "pelanggaran."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
        # ── UU 6/2023 — Cipta Kerja (Employment Cluster) ──
        {
            "source_law": "UU No. 6 Tahun 2023 tentang Penetapan Perpu 2/2022 tentang Cipta Kerja menjadi UU",
            "source_law_short": "UU 6/2023",
            "category": "ketenagakerjaan",
            "bab": "IV",
            "bab_title": "Ketenagakerjaan",
            "pasal": "81 Angka 15 (Pasal 59)",
            "text": (
                "Pasal 59 (sebagaimana diubah oleh Pasal 81 Angka 15 UU 6/2023)\n"
                "(1) Perjanjian kerja waktu tertentu hanya dapat dibuat untuk pekerjaan tertentu yang "
                "menurut jenis dan sifat atau kegiatan pekerjaannya akan selesai dalam waktu tertentu, yaitu:\n"
                "a. pekerjaan yang sekali selesai atau yang sementara sifatnya;\n"
                "b. pekerjaan yang diperkirakan penyelesaiannya dalam waktu yang tidak terlalu lama;\n"
                "c. pekerjaan yang bersifat musiman;\n"
                "d. pekerjaan yang berhubungan dengan produk baru, kegiatan baru, atau produk tambahan "
                "yang masih dalam percobaan atau penjajakan; atau\n"
                "e. pekerjaan yang jenis dan sifat atau kegiatannya bersifat tidak tetap.\n"
                "(2) Perjanjian kerja waktu tertentu tidak dapat diadakan untuk pekerjaan yang bersifat "
                "tetap.\n"
                "(4) Perjanjian kerja waktu tertentu yang didasarkan atas jangka waktu tertentu dapat "
                "diadakan untuk paling lama 5 (lima) tahun."
            ),
            "effective_date": "2023-03-31",
            "is_active": True,
        },
        {
            "source_law": "UU No. 6 Tahun 2023 tentang Penetapan Perpu 2/2022 tentang Cipta Kerja menjadi UU",
            "source_law_short": "UU 6/2023",
            "category": "ketenagakerjaan",
            "bab": "IV",
            "bab_title": "Ketenagakerjaan",
            "pasal": "81 Angka 17 (Pasal 61A)",
            "text": (
                "Pasal 61A (disisipkan oleh Pasal 81 Angka 17 UU 6/2023)\n"
                "(1) Dalam hal perjanjian kerja waktu tertentu berakhir sebagaimana dimaksud dalam "
                "Pasal 61 ayat (1), pengusaha wajib memberikan uang kompensasi kepada pekerja/buruh.\n"
                "(2) Uang kompensasi sebagaimana dimaksud pada ayat (1) diberikan sesuai dengan "
                "ketentuan peraturan perundang-undangan."
            ),
            "effective_date": "2023-03-31",
            "is_active": True,
        },
        {
            "source_law": "UU No. 6 Tahun 2023 tentang Penetapan Perpu 2/2022 tentang Cipta Kerja menjadi UU",
            "source_law_short": "UU 6/2023",
            "category": "ketenagakerjaan",
            "bab": "IV",
            "bab_title": "Ketenagakerjaan",
            "pasal": "81 Angka 18-20 (Outsourcing/Alih Daya)",
            "text": (
                "Pasal 64-66 (sebagaimana diubah oleh Pasal 81 Angka 18-20 UU 6/2023)\n"
                "Hubungan alih daya (outsourcing):\n"
                "(1) Perusahaan dapat menyerahkan sebagian pelaksanaan pekerjaan kepada perusahaan lainnya "
                "melalui perjanjian alih daya yang dibuat secara tertulis.\n"
                "(2) Perusahaan alih daya harus berbentuk badan hukum dan wajib memenuhi Perizinan Berusaha.\n"
                "(3) Pelindungan pekerja/buruh, upah, kesejahteraan, syarat kerja, serta perselisihan "
                "yang timbul dilaksanakan sekurang-kurangnya sesuai dengan ketentuan peraturan "
                "perundang-undangan dan menjadi tanggung jawab perusahaan alih daya.\n"
                "(4) Perjanjian kerja antara perusahaan alih daya dengan pekerja/buruh yang dipekerjakan "
                "dapat berupa PKWT atau PKWTT."
            ),
            "effective_date": "2023-03-31",
            "is_active": True,
        },
        {
            "source_law": "UU No. 6 Tahun 2023 tentang Penetapan Perpu 2/2022 tentang Cipta Kerja menjadi UU",
            "source_law_short": "UU 6/2023",
            "category": "ketenagakerjaan",
            "bab": "IV",
            "bab_title": "Ketenagakerjaan",
            "pasal": "81 Angka 23 (Pasal 77 — Waktu Kerja)",
            "text": (
                "Pasal 77 (sebagaimana diubah oleh Pasal 81 Angka 23 UU 6/2023)\n"
                "(1) Setiap Pengusaha wajib melaksanakan ketentuan waktu kerja.\n"
                "(2) Waktu kerja sebagaimana dimaksud pada ayat (1) meliputi:\n"
                "a. 7 (tujuh) jam 1 (satu) hari dan 40 (empat puluh) jam 1 (satu) minggu untuk "
                "6 (enam) hari kerja dalam 1 (satu) minggu; atau\n"
                "b. 8 (delapan) jam 1 (satu) hari dan 40 (empat puluh) jam 1 (satu) minggu untuk "
                "5 (lima) hari kerja dalam 1 (satu) minggu.\n"
                "(3) Ketentuan waktu kerja sebagaimana dimaksud pada ayat (2) tidak berlaku bagi "
                "sektor usaha atau pekerjaan tertentu.\n"
                "(4) Waktu kerja lembur paling banyak 4 (empat) jam dalam 1 (satu) hari dan "
                "18 (delapan belas) jam dalam 1 (satu) minggu."
            ),
            "effective_date": "2023-03-31",
            "is_active": True,
        },
        # ── UU 27/2022 PDP — Security & DPO ──
        {
            "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "source_law_short": "UU 27/2022",
            "category": "data_protection",
            "bab": "VIII",
            "bab_title": "Keamanan Data Pribadi",
            "pasal": "35",
            "text": (
                "Pasal 35\n"
                "(1) Pengendali Data Pribadi wajib melindungi dan memastikan keamanan Data Pribadi "
                "yang diprosesnya, dengan melakukan:\n"
                "a. penyusunan dan penerapan langkah teknis operasional untuk melindungi Data Pribadi "
                "dari gangguan pemrosesan Data Pribadi yang bertentangan dengan ketentuan peraturan "
                "perundang-undangan; dan\n"
                "b. penentuan tingkat keamanan Data Pribadi dengan memperhatikan sifat dan risiko "
                "dari Data Pribadi yang harus dilindungi dalam pemrosesan Data Pribadi.\n"
                "(2) Langkah teknis operasional sebagaimana dimaksud pada ayat (1) paling sedikit meliputi:\n"
                "a. penyelenggaraan tata kelola Pelindungan Data Pribadi;\n"
                "b. Pelindungan Data Pribadi dilakukan uji coba secara berkala;\n"
                "c. penjagaan kerahasiaan Data Pribadi."
            ),
            "effective_date": "2022-10-17",
            "is_active": True,
        },
    ]
    return entries


# ---------------------------------------------------------------------------
# PDF extraction (for future use when PDFs are downloaded)
# ---------------------------------------------------------------------------
LAW_PDF_CONFIG = {
    "uu_cipta_kerja": {
        "filename": "uu_6_2023_cipta_kerja.pdf",
        "source_law": "UU No. 6 Tahun 2023 tentang Penetapan Perpu 2/2022 tentang Cipta Kerja menjadi UU",
        "source_law_short": "UU 6/2023",
        "category": "ketenagakerjaan",
        "effective_date": "2023-03-31",
    },
    "uu_pdp": {
        "filename": "uu_27_2022_pdp.pdf",
        "source_law": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
        "source_law_short": "UU 27/2022",
        "category": "data_protection",
        "effective_date": "2022-10-17",
    },
    "uu_bahasa": {
        "filename": "uu_24_2009_bahasa.pdf",
        "source_law": "UU No. 24 Tahun 2009 tentang Bendera, Bahasa, dan Lambang Negara, serta Lagu Kebangsaan",
        "source_law_short": "UU 24/2009",
        "category": "bahasa",
        "effective_date": "2009-07-09",
    },
    "pp_pkwt": {
        "filename": "pp_35_2021_pkwt.pdf",
        "source_law": "PP No. 35 Tahun 2021 tentang PKWT, Alih Daya, Waktu Kerja, dan PHK",
        "source_law_short": "PP 35/2021",
        "category": "ketenagakerjaan",
        "effective_date": "2021-02-02",
    },
    "pojk_it_bank": {
        "filename": "pojk_11_2022_it_bank.pdf",
        "source_law": "POJK No. 11/POJK.03/2022 tentang Penyelenggaraan TI oleh Bank Umum",
        "source_law_short": "POJK 11/2022",
        "category": "perbankan",
        "effective_date": "2022-09-07",
    },
}

DATA_DIR = os.path.join(os.path.dirname(__file__), "law_data")


def extract_pasals_from_pdf(pdf_path: str, config: dict) -> List[Dict[str, Any]]:
    """Extract pasal-level chunks from a PDF using PyMuPDF."""
    try:
        import fitz
    except ImportError:
        print("ERROR: PyMuPDF (fitz) not installed. Run: pip install pymupdf")
        return []

    doc = fitz.open(pdf_path)
    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"
    doc.close()

    # Split by Pasal boundary
    pasal_pattern = re.compile(r'(?=^Pasal\s+(\d+[A-Z]?))', re.MULTILINE)
    chunks = pasal_pattern.split(full_text)

    entries = []
    current_bab = ""
    current_bab_title = ""

    i = 0
    while i < len(chunks):
        chunk = chunks[i].strip()

        # Detect BAB headers for metadata
        bab_match = re.search(r'BAB\s+([IVXLC]+)\s*\n\s*(.+)', chunk)
        if bab_match:
            current_bab = bab_match.group(1)
            current_bab_title = bab_match.group(2).strip()

        if not chunk.startswith("Pasal"):
            i += 1
            continue

        pasal_match = re.match(r'Pasal\s+(\d+[A-Z]?)', chunk)
        pasal_num = pasal_match.group(1) if pasal_match else "Unknown"

        # Handle long pasals: split by Ayat if > 2000 chars
        if len(chunk) > 2000:
            ayat_splits = re.split(r'(?=\(\d+\)\s)', chunk)
            header = f"Pasal {pasal_num}"
            for j, ayat_chunk in enumerate(ayat_splits):
                ayat_chunk = ayat_chunk.strip()
                if not ayat_chunk:
                    continue
                text = f"{header}\n{ayat_chunk}" if not ayat_chunk.startswith("Pasal") else ayat_chunk
                entries.append({
                    "source_law": config["source_law"],
                    "source_law_short": config["source_law_short"],
                    "category": config["category"],
                    "bab": current_bab,
                    "bab_title": current_bab_title,
                    "pasal": f"{pasal_num}" if j == 0 else f"{pasal_num} Ayat ({j})",
                    "text": text[:3000],
                    "effective_date": config["effective_date"],
                    "is_active": True,
                })
        else:
            entries.append({
                "source_law": config["source_law"],
                "source_law_short": config["source_law_short"],
                "category": config["category"],
                "bab": current_bab,
                "bab_title": current_bab_title,
                "pasal": pasal_num,
                "text": chunk[:3000],
                "effective_date": config["effective_date"],
                "is_active": True,
            })
        i += 1

    return entries


# ---------------------------------------------------------------------------
# Upsert to Qdrant
# ---------------------------------------------------------------------------
def delete_law_entries(source_law_short: str):
    """Delete all vectors for a specific law before re-ingesting."""
    print(f"[FORCE] Deleting existing entries for {source_law_short}...")
    qdrant_client.delete(
        collection_name=COLLECTION,
        points_selector=Filter(
            must=[FieldCondition(key="source_law_short", match=MatchValue(value=source_law_short))]
        ),
    )
    print(f"[FORCE] Deleted entries for {source_law_short}.")


def upsert_entries(entries: List[Dict[str, Any]], force: bool = False):
    """Embed and upsert entries to Qdrant in batches."""
    if not entries:
        print("No entries to upsert.")
        return 0

    # Group by source_law_short for force-delete
    if force:
        laws_to_delete = set(e["source_law_short"] for e in entries)
        for law in laws_to_delete:
            delete_law_entries(law)

    points = []
    for i, entry in enumerate(entries):
        print(f"  Embedding [{i+1}/{len(entries)}]: {entry['source_law_short']} Pasal {entry['pasal']}")
        vector = get_embedding(entry["text"])
        point = PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload=entry,
        )
        points.append(point)

        # Batch upsert
        if len(points) >= BATCH_SIZE:
            qdrant_client.upsert(collection_name=COLLECTION, points=points)
            print(f"  Upserted batch of {len(points)} points.")
            points = []

    # Final batch
    if points:
        qdrant_client.upsert(collection_name=COLLECTION, points=points)
        print(f"  Upserted final batch of {len(points)} points.")

    return len(entries)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Ingest Indonesian national laws into Qdrant")
    parser.add_argument("--law", type=str, help="Specific law key (e.g., uu_pdp, uu_cipta_kerja)")
    parser.add_argument("--force", action="store_true", help="Delete existing entries before re-ingesting")
    parser.add_argument("--manual-only", action="store_true", help="Only ingest curated manual entries")
    args = parser.parse_args()

    print("=" * 60)
    print("Indonesian National Law Ingestion Pipeline")
    print("=" * 60)

    # Ensure collection exists
    ensure_collection()

    total = 0

    # Always ingest manual entries unless a specific law is targeted
    if args.manual_only or not args.law:
        print("\n--- Ingesting curated manual entries ---")
        manual = get_manual_entries()
        count = upsert_entries(manual, force=args.force)
        total += count
        print(f"✅ Ingested {count} curated manual entries.")

    if args.manual_only:
        print(f"\n{'=' * 60}")
        print(f"DONE. Total vectors ingested: {total}")
        # Print collection stats
        info = qdrant_client.get_collection(COLLECTION)
        print(f"Collection '{COLLECTION}' now has {info.points_count} total vectors.")
        return

    # PDF ingestion
    configs_to_process = {}
    if args.law:
        if args.law in LAW_PDF_CONFIG:
            configs_to_process = {args.law: LAW_PDF_CONFIG[args.law]}
        else:
            print(f"ERROR: Unknown law key '{args.law}'. Available: {list(LAW_PDF_CONFIG.keys())}")
            sys.exit(1)
    else:
        configs_to_process = LAW_PDF_CONFIG

    for key, config in configs_to_process.items():
        pdf_path = os.path.join(DATA_DIR, config["filename"])
        if not os.path.exists(pdf_path):
            print(f"\n⚠️  PDF not found: {pdf_path} — skipping {key}")
            continue

        print(f"\n--- Ingesting {key}: {config['source_law_short']} ---")
        entries = extract_pasals_from_pdf(pdf_path, config)
        if entries:
            count = upsert_entries(entries, force=args.force)
            total += count
            print(f"✅ Ingested {count} entries from {config['source_law_short']}.")
        else:
            print(f"⚠️  No pasal entries extracted from {config['filename']}")

    print(f"\n{'=' * 60}")
    print(f"DONE. Total vectors ingested this run: {total}")
    info = qdrant_client.get_collection(COLLECTION)
    print(f"Collection '{COLLECTION}' now has {info.points_count} total vectors.")


if __name__ == "__main__":
    main()
