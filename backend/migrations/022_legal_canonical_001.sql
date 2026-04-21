-- Migration 022: Regulatory Intelligence Canonical Law Corpus
-- Purpose: Create the canonical global legal corpus for retrieval, validity, coverage,
-- and verification semantics. This module is global and must never be joined to tenant-owned tables.

CREATE TABLE IF NOT EXISTS laws (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_name TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    law_type TEXT NOT NULL,
    number TEXT NOT NULL,
    year INTEGER NOT NULL,
    category TEXT NOT NULL,
    jurisdiction TEXT NOT NULL DEFAULT 'ID',
    promulgation_date DATE NOT NULL,
    effective_date DATE NOT NULL,
    legal_status TEXT NOT NULL CHECK (legal_status IN ('berlaku', 'diubah', 'dicabut', 'diuji_mk', 'sebagian_dicabut')),
    official_source_url TEXT NOT NULL,
    official_document_checksum TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (law_type, number, year)
);

CREATE INDEX IF NOT EXISTS idx_laws_legal_status ON laws(legal_status);
CREATE INDEX IF NOT EXISTS idx_laws_category ON laws(category);
CREATE INDEX IF NOT EXISTS idx_laws_short_name ON laws(short_name);

CREATE TABLE IF NOT EXISTS law_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    law_id UUID NOT NULL REFERENCES laws(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    amendment_source_law_id UUID REFERENCES laws(id),
    amendment_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (law_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_law_versions_temporal ON law_versions(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_law_versions_law ON law_versions(law_id);

CREATE TABLE IF NOT EXISTS structural_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    law_version_id UUID NOT NULL REFERENCES law_versions(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL CHECK (node_type IN ('bab', 'bagian', 'paragraf', 'pasal', 'ayat', 'huruf', 'angka')),
    parent_id UUID REFERENCES structural_nodes(id) ON DELETE CASCADE,
    identifier TEXT NOT NULL,
    identifier_normalized TEXT NOT NULL,
    sequence_order INTEGER NOT NULL,
    heading TEXT,
    body TEXT,
    body_en TEXT,
    legal_status TEXT NOT NULL DEFAULT 'berlaku' CHECK (legal_status IN ('berlaku', 'diubah', 'dicabut', 'diuji_mk', 'sebagian_dicabut')),
    legal_status_notes TEXT,
    legal_status_source_url TEXT,
    effective_from DATE NOT NULL,
    effective_to DATE,
    topic_tags TEXT[] DEFAULT '{}',
    contract_relevance TEXT CHECK (contract_relevance IN ('high', 'medium', 'low')),
    contract_types TEXT[] DEFAULT '{}',
    compliance_trigger TEXT,
    source_document_position INTEGER,
    extraction_method TEXT NOT NULL DEFAULT 'manual',
    extraction_confidence FLOAT,
    seeded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seeded_by TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (verification_status IN ('unreviewed', 'human_verified', 'human_rejected')),
    human_verified_by TEXT,
    human_verified_at TIMESTAMPTZ,
    verification_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (law_version_id, parent_id, identifier_normalized)
);

CREATE INDEX IF NOT EXISTS idx_nodes_law_version ON structural_nodes(law_version_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON structural_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON structural_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_legal_status ON structural_nodes(legal_status);
CREATE INDEX IF NOT EXISTS idx_nodes_identifier ON structural_nodes(identifier_normalized);
CREATE INDEX IF NOT EXISTS idx_nodes_relevance ON structural_nodes(contract_relevance) WHERE contract_relevance = 'high';

CREATE TABLE IF NOT EXISTS pasal_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_node_id UUID NOT NULL REFERENCES structural_nodes(id) ON DELETE CASCADE,
    target_node_id UUID REFERENCES structural_nodes(id) ON DELETE SET NULL,
    target_law_short TEXT NOT NULL,
    target_identifier TEXT NOT NULL,
    reference_context TEXT NOT NULL,
    reference_type TEXT NOT NULL CHECK (reference_type IN ('direct', 'conditional', 'implementing')),
    is_intra_law BOOLEAN NOT NULL,
    extraction_method TEXT NOT NULL,
    extraction_confidence FLOAT NOT NULL,
    verified_at TIMESTAMPTZ,
    verified_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refs_source ON pasal_references(source_node_id);
CREATE INDEX IF NOT EXISTS idx_refs_target ON pasal_references(target_node_id);
CREATE INDEX IF NOT EXISTS idx_refs_target_unresolved ON pasal_references(target_law_short, target_identifier) WHERE target_node_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_refs_intra ON pasal_references(is_intra_law);

CREATE TABLE IF NOT EXISTS corpus_coverage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL UNIQUE,
    category_label_id TEXT NOT NULL,
    category_label_en TEXT NOT NULL,
    total_planned_laws INTEGER NOT NULL,
    ingested_laws INTEGER NOT NULL DEFAULT 0,
    verified_laws INTEGER NOT NULL DEFAULT 0,
    coverage_level TEXT NOT NULL CHECK (coverage_level IN ('not_started', 'in_progress', 'substantial', 'comprehensive')),
    coverage_notes TEXT,
    last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DEV ROLLBACK (run manually when needed)
-- DROP TABLE IF EXISTS pasal_references;
-- DROP TABLE IF EXISTS structural_nodes;
-- DROP TABLE IF EXISTS law_versions;
-- DROP TABLE IF EXISTS corpus_coverage;
-- DROP TABLE IF EXISTS laws;
