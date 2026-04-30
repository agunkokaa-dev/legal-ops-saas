export const navLinks = [
  ["Features", "#features"],
  ["War Room", "#war-room"],
  ["Clause Assistant", "#assistant"],
  ["Pricing", "#pricing"],
] as const;

export const faqItems = [
  ["Is clause.id only for Indonesian contracts?", "No. clause.id supports bilingual and English contracts, but it is designed around workflows Indonesian legal teams actually use."],
  ["Does the AI provide source-backed answers?", "Yes. Findings and assistant answers are designed to reference the source contract, playbook rule, or regulatory context used."],
  ["Can we enforce our own legal playbook?", "Yes. Playbook rules can become review standards, fallback positions, and negotiation guidance."],
  ["How does the War Room help negotiations?", "It compares versions, tracks issues, suggests BATNAs, and maintains reasoning around each negotiation decision."],
  ["Is this built for sensitive legal data?", "The product is designed around tenant isolation, JWT authentication, scoped retrieval, and source-backed AI outputs."],
  ["Does it support obligations after signing?", "Yes. Obligations can be extracted during review and activated into legal operations tasks after execution."],
] as const;

export const comparisonRows = [
  "AI Review Speed",
  "Playbook Enforcement",
  "Bilingual Support",
  "Negotiation Intelligence",
  "Document Genealogy",
  "Indonesian Regulatory Context",
  "Source-backed Answers",
  "Obligation Tracking",
] as const;

export const features = [
  ["AI Contract Review", "Identify risk, obligations, and compliance issues with source references."],
  ["Negotiation War Room", "Compare versions and resolve issues with fallback reasoning."],
  ["Clause Assistant", "Ask source-backed questions across contract context."],
  ["Document Genealogy", "Map relationships across MSA, SOW, DPA, and amendments."],
  ["Playbook Enforcement", "Turn rules into active standards and fallback suggestions."],
  ["Smart Drafting", "Generate revisions aligned with your standard positions."],
  ["Bilingual Workflow", "Support Indonesian and English contract workflows."],
  ["Indonesian Regulatory Context", "Ground review in local legal and compliance references."],
  ["Obligation Tracking", "Extract and activate post-signature obligations."],
  ["Task Management", "Convert escalations into trackable legal ops tasks."],
  ["Intake Portal", "Structure new legal requests before contracts begin."],
  ["Real-Time Progress", "Show agent status and review progress as work happens."],
] as const;

export const pillars = [
  ["AI Contract Review", "Review contracts in minutes, not days", "Surface risk, compliance findings, key obligations, and source references before a lawyer starts deep review.", ["Risk Score", "Compliance Findings", "Key Obligations", "Source Reference"]],
  ["Negotiation War Room", "Negotiate with reasoning, not guesswork", "Compare versions, track issues, evaluate fallback positions, and keep negotiation decisions tied to evidence.", ["Version Compare", "Fallback", "Issue Tracker", "Severity"]],
  ["Clause Assistant", "Ask across contracts, playbooks, and Indonesian regulations", "Get source-backed answers across the agreement, internal playbook, and regulatory context.", ["Triple Context", "Evidence Stack", "Playbook QA", "Regulatory Context"]],
  ["Document Genealogy", "See how every contract connects", "Understand how MSAs, SOWs, DPAs, amendments, and order forms relate across a matter.", ["MSA", "SOW", "Amendment", "DPA"]],
  ["Playbook Enforcement", "Turn your legal playbook into an active standard", "Convert fallback rules and standard positions into live review guidance and negotiation recommendations.", ["Fallback Rules", "Redlines", "Standard Positions", "Severity"]],
  ["Indonesia-Specific Workflows", "Built for the way Indonesian legal teams actually work", "Support bilingual clauses, local regulatory context, and execution workflows designed for Indonesia.", ["Bilingual", "UU PDP", "Local Context", "e-Meterai readiness"]],
] as const;

export const workflowSteps = [
  ["Upload", "Drop in contracts, SOWs, amendments, DPAs, or supporting documents."],
  ["AI Review", "The 7-agent pipeline extracts risks, obligations, clauses, and source-backed findings."],
  ["War Room", "Compare versions, track concessions, and resolve negotiation issues with a clear audit trail."],
  ["Ask Clause Assistant", "Ask across contracts, playbooks, and Indonesian regulatory context."],
  ["Task & Execution", "Convert obligations and escalations into trackable legal operations tasks."],
] as const;

export const indonesiaItems = [
  ["Bilingual-first workflows", "Review and synchronize Indonesian and English clauses in one workspace."],
  ["Regulatory context", "Designed for local references including UU PDP, OJK, and BKPM-oriented workflows."],
  ["e-Meterai readiness", "Prepare executed agreements for Indonesia-specific signing and stamping flows."],
  ["Legal operations focus", "Move from legal review into tasks, obligations, approvals, and execution."],
  ["Source-backed AI", "Every answer and finding is designed to show its supporting contract source."],
  ["Sensitive legal work", "Tenant isolation and scoped retrieval patterns for confidential contracts."],
] as const;

export const securityChecks = [
  "Tenant-isolated architecture",
  "JWT-based authentication",
  "Scoped database and vector retrieval",
  "Source-backed contract findings",
  "Real-time processing visibility",
  "Designed to avoid black-box AI outputs",
] as const;
