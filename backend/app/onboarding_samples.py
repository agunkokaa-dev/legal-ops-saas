from __future__ import annotations

import base64
import io
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class SourceBackedItem:
    source_text: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class SampleContract:
    slug: str
    title: str
    category: str
    filename: str
    counterparty: str
    raw_text: str
    risk_score: float
    risk_level: str
    contract_value: float
    currency: str
    end_date: str
    effective_date: str
    jurisdiction: str
    governing_law: str
    quick_insights: list[dict[str, str]]
    findings: list[SourceBackedItem]
    obligations: list[SourceBackedItem]
    clauses: list[SourceBackedItem]
    draft_revisions: list[SourceBackedItem]


NDA_TEXT = """PERJANJIAN KERAHASIAAN (NDA)

Antara PT Tech Indonesia ("Pihak Pengungkap") dan PT Mitra Data Nusantara ("Pihak Penerima").

1. Data Pribadi
Pihak Penerima dapat memproses data pribadi pelanggan hanya untuk tujuan evaluasi kerja sama dan wajib menerapkan langkah keamanan yang wajar.

2. Transfer Data
Pihak Penerima dilarang mengalihkan data pribadi ke luar wilayah Indonesia tanpa persetujuan tertulis Pihak Pengungkap dan dasar hukum yang sah.

3. Jangka Waktu
Kewajiban kerahasiaan berlaku selama 3 (tiga) tahun setelah Perjanjian berakhir.

4. Ganti Rugi
Pihak Penerima bertanggung jawab atas kerugian langsung yang timbul dari pelanggaran kerahasiaan.
"""


MSA_TEXT = """PERJANJIAN INDUK LAYANAN KONSULTASI (MSA)

PT Nusantara Advisory ("Konsultan") dan PT Prima Retail Indonesia ("Klien") sepakat atas ketentuan layanan berikut.

1. Ruang Lingkup
Konsultan akan memberikan layanan konsultasi strategi, implementasi sistem, dan pendampingan perubahan organisasi sesuai setiap SOW.

2. Pembayaran
Klien wajib membayar invoice yang sah dalam waktu 30 (tiga puluh) hari kalender sejak tanggal penerimaan invoice.

3. Pembatasan Tanggung Jawab
Total tanggung jawab Konsultan dibatasi sampai jumlah biaya yang telah dibayarkan Klien dalam 3 (tiga) bulan terakhir.

4. Kepatuhan
Para pihak wajib mematuhi peraturan perlindungan data pribadi, anti suap, dan ketentuan hukum Indonesia yang berlaku.

5. Pengakhiran
Masing-masing pihak dapat mengakhiri Perjanjian dengan pemberitahuan tertulis 30 hari sebelumnya apabila terjadi pelanggaran material.
"""


SOW_TEXT = """STATEMENT OF WORK PENGEMBANGAN APLIKASI

SOW ini dibuat berdasarkan MSA antara PT Nusantara Advisory dan PT Prima Retail Indonesia.

1. Deliverables
Vendor akan membangun aplikasi procurement internal, termasuk modul vendor onboarding, approval workflow, dan dashboard audit.

2. Timeline
Fase desain diselesaikan paling lambat 15 Mei 2026, fase pengembangan paling lambat 30 Juni 2026, dan UAT paling lambat 15 Juli 2026.

3. Acceptance
Deliverable dianggap diterima apabila Klien tidak memberikan keberatan tertulis dalam 5 (lima) hari kerja setelah UAT.

4. Perubahan Ruang Lingkup
Setiap perubahan ruang lingkup wajib disetujui secara tertulis melalui change request sebelum dikerjakan.

5. Biaya
Nilai pekerjaan untuk SOW ini adalah Rp750.000.000 belum termasuk pajak yang berlaku.
"""


SAMPLE_CONTRACTS: list[SampleContract] = [
    SampleContract(
        slug="nda-indonesia",
        title="Sample NDA - PT Tech Indonesia",
        category="NDA",
        filename="sample_nda_indonesia.pdf",
        counterparty="PT Mitra Data Nusantara",
        raw_text=NDA_TEXT,
        risk_score=62.0,
        risk_level="Medium",
        contract_value=0.0,
        currency="IDR",
        end_date="2029-04-28",
        effective_date="2026-04-28",
        jurisdiction="Indonesia",
        governing_law="Hukum Republik Indonesia",
        quick_insights=[
            {"label": "Document Type", "value": "NDA", "icon": "description"},
            {"label": "Primary Risk", "value": "Cross-border data transfer", "icon": "policy"},
            {"label": "Term", "value": "3 years post-termination", "icon": "event"},
        ],
        findings=[
            SourceBackedItem(
                source_text="Pihak Penerima dilarang mengalihkan data pribadi ke luar wilayah Indonesia tanpa persetujuan tertulis Pihak Pengungkap dan dasar hukum yang sah.",
                payload={
                    "severity": "warning",
                    "category": "Regulatory",
                    "title": "Cross-border data transfer needs legal basis",
                    "description": "Klausul transfer data sudah meminta persetujuan tertulis, tetapi perlu memperjelas dasar pemrosesan dan kewajiban dokumentasi agar selaras dengan UU PDP.",
                    "suggested_revision": "Pihak Penerima hanya dapat mengalihkan data pribadi ke luar wilayah Indonesia setelah memperoleh persetujuan tertulis Pihak Pengungkap, memastikan dasar hukum yang sah, dan mendokumentasikan penilaian kepatuhan sesuai UU PDP.",
                    "playbook_reference": "Indonesian Privacy Playbook: cross-border transfer approval",
                },
            ),
            SourceBackedItem(
                source_text="Kewajiban kerahasiaan berlaku selama 3 (tiga) tahun setelah Perjanjian berakhir.",
                payload={
                    "severity": "info",
                    "category": "Term",
                    "title": "Confidentiality tail is time-limited",
                    "description": "Jangka waktu 3 tahun lazim, tetapi rahasia dagang atau source code biasanya perlu perlindungan selama informasi tersebut tetap rahasia.",
                    "suggested_revision": "Kewajiban kerahasiaan berlaku selama 3 (tiga) tahun setelah Perjanjian berakhir, kecuali untuk rahasia dagang yang berlaku selama informasi tersebut tetap bersifat rahasia.",
                    "playbook_reference": "Confidentiality Playbook: trade secret tail",
                },
            ),
        ],
        obligations=[
            SourceBackedItem(
                source_text="Pihak Penerima dapat memproses data pribadi pelanggan hanya untuk tujuan evaluasi kerja sama dan wajib menerapkan langkah keamanan yang wajar.",
                payload={"description": "Use personal data only for evaluation and maintain reasonable security controls.", "due_date": None},
            )
        ],
        clauses=[
            SourceBackedItem(
                source_text="Pihak Penerima bertanggung jawab atas kerugian langsung yang timbul dari pelanggaran kerahasiaan.",
                payload={"clause_type": "Liability", "ai_summary": "The receiving party is liable for direct losses from confidentiality breaches."},
            )
        ],
        draft_revisions=[
            SourceBackedItem(
                source_text="Pihak Penerima bertanggung jawab atas kerugian langsung yang timbul dari pelanggaran kerahasiaan.",
                payload={
                    "original_issue": "Liability only covers direct losses and may not address regulatory penalties.",
                    "neutral_rewrite": "Pihak Penerima bertanggung jawab atas kerugian langsung, denda regulator, dan biaya pemulihan yang wajar akibat pelanggaran kerahasiaan atau perlindungan data pribadi.",
                },
            )
        ],
    ),
    SampleContract(
        slug="msa-2024",
        title="Sample MSA - Layanan Konsultasi",
        category="MSA",
        filename="sample_msa_2024.pdf",
        counterparty="PT Prima Retail Indonesia",
        raw_text=MSA_TEXT,
        risk_score=48.0,
        risk_level="Medium",
        contract_value=1_500_000_000.0,
        currency="IDR",
        end_date="2027-04-28",
        effective_date="2026-04-28",
        jurisdiction="Indonesia",
        governing_law="Hukum Republik Indonesia",
        quick_insights=[
            {"label": "Payment Terms", "value": "Net 30", "icon": "payments"},
            {"label": "Liability Cap", "value": "3 months fees", "icon": "shield"},
            {"label": "Termination Notice", "value": "30 days", "icon": "event_busy"},
        ],
        findings=[
            SourceBackedItem(
                source_text="Total tanggung jawab Konsultan dibatasi sampai jumlah biaya yang telah dibayarkan Klien dalam 3 (tiga) bulan terakhir.",
                payload={
                    "severity": "warning",
                    "category": "Risk",
                    "title": "Liability cap may be too low",
                    "description": "Batas tanggung jawab 3 bulan biaya dapat terlalu rendah untuk insiden data, IP, atau pelanggaran kerahasiaan.",
                    "suggested_revision": "Total tanggung jawab Konsultan dibatasi sampai jumlah biaya yang telah dibayarkan dalam 12 (dua belas) bulan terakhir, kecuali untuk pelanggaran kerahasiaan, pelanggaran data pribadi, IP, fraud, atau kesengajaan.",
                    "playbook_reference": "Liability Playbook: carve-outs for high-impact breaches",
                },
            )
        ],
        obligations=[
            SourceBackedItem(
                source_text="Klien wajib membayar invoice yang sah dalam waktu 30 (tiga puluh) hari kalender sejak tanggal penerimaan invoice.",
                payload={"description": "Pay valid invoices within 30 calendar days of receipt.", "due_date": None},
            )
        ],
        clauses=[
            SourceBackedItem(
                source_text="Para pihak wajib mematuhi peraturan perlindungan data pribadi, anti suap, dan ketentuan hukum Indonesia yang berlaku.",
                payload={"clause_type": "Compliance", "ai_summary": "Both parties must comply with privacy, anti-bribery, and Indonesian law requirements."},
            )
        ],
        draft_revisions=[
            SourceBackedItem(
                source_text="Total tanggung jawab Konsultan dibatasi sampai jumlah biaya yang telah dibayarkan Klien dalam 3 (tiga) bulan terakhir.",
                payload={
                    "original_issue": "Liability cap lacks standard carve-outs.",
                    "neutral_rewrite": "Batas tanggung jawab tidak berlaku untuk pelanggaran kerahasiaan, pelanggaran data pribadi, penyalahgunaan IP, fraud, atau kesengajaan.",
                },
            )
        ],
    ),
    SampleContract(
        slug="sow-aplikasi",
        title="Sample SOW - Pengembangan Aplikasi",
        category="SOW",
        filename="sample_sow_aplikasi.pdf",
        counterparty="PT Prima Retail Indonesia",
        raw_text=SOW_TEXT,
        risk_score=34.0,
        risk_level="Low",
        contract_value=750_000_000.0,
        currency="IDR",
        end_date="2026-07-15",
        effective_date="2026-04-28",
        jurisdiction="Indonesia",
        governing_law="Hukum Republik Indonesia",
        quick_insights=[
            {"label": "Contract Value", "value": "Rp750.000.000", "icon": "payments"},
            {"label": "UAT Deadline", "value": "15 Jul 2026", "icon": "event"},
            {"label": "Acceptance Window", "value": "5 business days", "icon": "task_alt"},
        ],
        findings=[
            SourceBackedItem(
                source_text="Deliverable dianggap diterima apabila Klien tidak memberikan keberatan tertulis dalam 5 (lima) hari kerja setelah UAT.",
                payload={
                    "severity": "info",
                    "category": "Operational",
                    "title": "Deemed acceptance window is short",
                    "description": "Acceptance otomatis 5 hari kerja mempercepat closure, tetapi klien mungkin perlu waktu lebih panjang untuk regression testing.",
                    "suggested_revision": "Deliverable dianggap diterima apabila Klien tidak memberikan keberatan tertulis yang wajar dalam 10 (sepuluh) hari kerja setelah UAT selesai.",
                    "playbook_reference": "Delivery Playbook: acceptance period",
                },
            )
        ],
        obligations=[
            SourceBackedItem(
                source_text="Fase desain diselesaikan paling lambat 15 Mei 2026, fase pengembangan paling lambat 30 Juni 2026, dan UAT paling lambat 15 Juli 2026.",
                payload={"description": "Complete design, development, and UAT by the stated milestone dates.", "due_date": "2026-07-15"},
            )
        ],
        clauses=[
            SourceBackedItem(
                source_text="Setiap perubahan ruang lingkup wajib disetujui secara tertulis melalui change request sebelum dikerjakan.",
                payload={"clause_type": "Change Control", "ai_summary": "Scope changes require written change request approval before work starts."},
            )
        ],
        draft_revisions=[
            SourceBackedItem(
                source_text="Deliverable dianggap diterima apabila Klien tidak memberikan keberatan tertulis dalam 5 (lima) hari kerja setelah UAT.",
                payload={
                    "original_issue": "Short deemed-acceptance window may be impractical for complex UAT.",
                    "neutral_rewrite": "Deliverable dianggap diterima apabila Klien tidak memberikan keberatan tertulis yang spesifik dalam 10 (sepuluh) hari kerja setelah UAT selesai.",
                },
            )
        ],
    ),
]


def _coordinates(raw_text: str, source_text: str) -> dict[str, Any]:
    start = raw_text.index(source_text)
    return {
        "start_char": start,
        "end_char": start + len(source_text),
        "source_text": source_text,
    }


def _count_findings(findings: list[dict[str, Any]]) -> dict[str, int]:
    critical = sum(1 for finding in findings if finding["severity"] == "critical")
    warning = sum(1 for finding in findings if finding["severity"] == "warning")
    info = sum(1 for finding in findings if finding["severity"] == "info")
    return {
        "critical_count": critical,
        "warning_count": warning,
        "info_count": info,
        "total_count": len(findings),
    }


def build_sample_payload(sample: SampleContract) -> dict[str, Any]:
    findings = [
        {
            "finding_id": f"sample-{sample.slug}-{index + 1}",
            "coordinates": _coordinates(sample.raw_text, item.source_text),
            "status": "open",
            **item.payload,
        }
        for index, item in enumerate(sample.findings)
    ]
    banner = _count_findings(findings)

    risk_flags_v2 = [
        {
            "flag": finding["title"],
            "severity": finding["severity"],
            **finding["coordinates"],
        }
        for finding in findings
        if finding["severity"] in {"critical", "warning"}
    ]
    compliance_findings_v2 = [
        {
            "issue": finding["description"],
            "category": finding["category"],
            **finding["coordinates"],
        }
        for finding in findings
        if finding["category"] in {"Regulatory", "Compliance"}
    ]
    obligations_v2 = [
        {
            **item.payload,
            **_coordinates(sample.raw_text, item.source_text),
        }
        for item in sample.obligations
    ]
    classified_clauses_v2 = [
        {
            **item.payload,
            "original_text": item.source_text,
            **{key: value for key, value in _coordinates(sample.raw_text, item.source_text).items() if key != "source_text"},
        }
        for item in sample.clauses
    ]
    draft_revisions_v2 = [
        {
            **item.payload,
            **_coordinates(sample.raw_text, item.source_text),
        }
        for item in sample.draft_revisions
    ]

    pipeline_output = {
        "schema_version": 1,
        "review_findings": findings,
        "quick_insights": sample.quick_insights,
        "banner": banner,
        "pipeline_output_quality": "complete",
        "risk_score": sample.risk_score,
        "risk_level": sample.risk_level,
        "risk_flags_v2": risk_flags_v2,
        "compliance_findings_v2": compliance_findings_v2,
        "draft_revisions_v2": draft_revisions_v2,
        "obligations_v2": obligations_v2,
        "classified_clauses_v2": classified_clauses_v2,
        "contract_value": sample.contract_value,
        "currency": sample.currency,
        "end_date": sample.end_date,
        "effective_date": sample.effective_date,
        "jurisdiction": sample.jurisdiction,
        "governing_law": sample.governing_law,
    }

    return {
        "findings": findings,
        "banner": banner,
        "pipeline_output": pipeline_output,
        "obligations_v2": obligations_v2,
        "classified_clauses_v2": classified_clauses_v2,
        "draft_revisions_v2": draft_revisions_v2,
    }


def generate_sample_pdf_data_url(title: str, raw_text: str) -> tuple[str, int]:
    pdf_bytes = _render_pdf_bytes(title, raw_text)
    encoded = base64.b64encode(pdf_bytes).decode("ascii")
    return f"data:application/pdf;base64,{encoded}", len(pdf_bytes)


def _render_pdf_bytes(title: str, raw_text: str) -> bytes:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except Exception:
        return _render_minimal_pdf_bytes(title, raw_text)

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    margin = 54
    y = height - margin
    line_height = 14

    pdf.setTitle(title)
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(margin, y, title[:92])
    y -= line_height * 2
    pdf.setFont("Helvetica", 10)

    for paragraph in raw_text.splitlines():
        wrapped_lines = _wrap_text(paragraph, max_chars=92) or [""]
        for line in wrapped_lines:
            if y < margin:
                pdf.showPage()
                pdf.setFont("Helvetica", 10)
                y = height - margin
            pdf.drawString(margin, y, line)
            y -= line_height
    pdf.save()
    return buffer.getvalue()


def _wrap_text(value: str, max_chars: int) -> list[str]:
    cleaned = value.strip()
    if not cleaned:
        return []
    words = cleaned.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
    if current:
        lines.append(current)
    return lines


def _render_minimal_pdf_bytes(title: str, raw_text: str) -> bytes:
    lines = [title, ""] + raw_text.splitlines()
    safe_lines = [
        re.sub(r"[^\x20-\x7E]", " ", line).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")[:92]
        for line in lines[:48]
    ]
    text_ops = ["BT", "/F1 10 Tf", "54 790 Td"]
    for index, line in enumerate(safe_lines):
        if index:
            text_ops.append("0 -14 Td")
        text_ops.append(f"({line}) Tj")
    text_ops.append("ET")
    stream = "\n".join(text_ops).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{idx} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(output)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_uuid() -> str:
    return str(uuid.uuid4())
