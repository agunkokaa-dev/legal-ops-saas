import os
import json
import operator
from typing import TypedDict, Annotated, List, Dict, Any
from dotenv import load_dotenv
from openai import OpenAI
from langgraph.graph import StateGraph, START, END

# Load environment variables
load_dotenv()

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

from pydantic import BaseModel, Field
from typing import Optional, Dict

class ExtractedClause(BaseModel):
    clause_name: str = Field(description="The name of the clause (e.g., 'Indemnity', 'Liability', 'Payment').")
    clause_text: str = Field(description="The exact text or summary of this clause.")

class ContractMetadata(BaseModel):
    contract_value: float = Field(default=0.0, description="The monetary value of the contract. Remove formatting and output raw number.")
    currency: str = Field(default="IDR", description="3-letter currency code (e.g., IDR, USD).")
    end_date: str = Field(default="Unknown", description="The termination date or duration.")
    effective_date: Optional[str] = Field(default=None, description="The date the agreement goes into effect.")
    jurisdiction: Optional[str] = Field(default=None, description="The legal jurisdiction.")
    governing_law: Optional[str] = Field(default=None, description="The governing law.")
    extracted_clauses: list[ExtractedClause] = Field(default_factory=list, description="A list of key clauses extracted from the contract.")

# ==========================================
# 1. State Definition (ContractState)
# ==========================================
class ContractState(TypedDict):
    """
    Shared state for the Contract Lifecycle Management (CLM) LangGraph.
    Data flows sequentially through agents and accumulates in this state.
    """
    contract_id: str
    raw_document: str             # The raw text extracted from the PDF
    extracted_clauses: Dict[str, Any] # Structured dictionary of key clauses
    contract_value: float         # Financial value or consideration found
    end_date: str                 # Termination or expiry date
    effective_date: str           # Date the agreement goes into effect
    jurisdiction: str             # Legal jurisdiction
    governing_law: str            # Governing law
    compliance_issues: Annotated[list, operator.add]  # List of legal/compliance violations found
    risk_flags: Annotated[list, operator.add]          # Specific risk warnings
    risk_score: float             # Calculated risk score (0-100)
    risk_level: str               # Categorical risk: 'High', 'Medium', 'Low', or 'Safe'
    counter_proposal: str         # Negotiation strategy / BATNA reasoning
    draft_revisions: Annotated[list, operator.add]     # Revised neutral/fair clauses
    extracted_obligations: Annotated[list, operator.add]  # Obligations mined from contract
    classified_clauses: Annotated[list, operator.add]     # Key clauses classified by type
    currency: str                 # ISO 4217 Currency Code (e.g., USD, IDR)

# ==========================================
# 2. Agent 01: Ingestion Agent
# ==========================================
def ingestion_agent(state: ContractState) -> ContractState:
    """
    AGENT 01: Parses the raw document to extract key metadata and clauses.
    Returns: contract_value, currency, end_date, and populated extracted_clauses.
    """
    print(f"[Agent 01: Ingestion] Processing contract: {state.get('contract_id', 'Unknown')}")
    
    prompt = f"""
    You are an expert Legal Document Parser.
    Extract the following from the provided contract text:
    1. 'contract_value': The total financial consideration or value as a number. If none, output 0.
    2. 'currency': The ISO 4217 currency code (e.g., 'IDR', 'USD', 'EUR'). If none or unclear, use 'IDR' as default.
    3. 'end_date': The termination date or duration. If none, say "Not Specified".
    4. 'effective_date': The date the agreement goes into effect.
    5. 'jurisdiction': The legal jurisdiction of the contract.
    6. 'governing_law': The governing law of the contract.
    7. 'extracted_clauses': A dictionary where keys are clause names (e.g., 'Indemnity', 'Liability') and values are the text.
    
    CONTRACT TEXT:
    {state.get('raw_document', '')}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            response_format=ContractMetadata,
            messages=[
                {"role": "system", "content": "You are a precise legal extraction engine."},
                {"role": "user", "content": prompt}
            ]
        )
        result = response.choices[0].message.parsed
        # Convert list[ExtractedClause] back to a dict for downstream agents
        clauses_dict = {c.clause_name: c.clause_text for c in result.extracted_clauses} if result.extracted_clauses else {}
        print(f"[Agent 01] Extracted: value={result.contract_value}, currency={result.currency}, end_date={result.end_date}")
        return {
            "contract_value": result.contract_value,
            "currency": result.currency,
            "end_date": result.end_date,
            "effective_date": result.effective_date,
            "jurisdiction": result.jurisdiction,
            "governing_law": result.governing_law,
            "extracted_clauses": clauses_dict
        }
    except Exception as e:
        print(f"Ingestion Agent Error: {e}")
        import traceback
        traceback.print_exc()
        return {"contract_value": 0.0, "currency": "IDR", "end_date": "Error", "effective_date": None, "jurisdiction": None, "governing_law": None, "extracted_clauses": {}}

class ComplianceAudit(BaseModel):
    compliance_issues: List[str] = Field(description="List of strings detailing the issues. Empty list if none.", default_factory=list)

class RiskAssessment(BaseModel):
    risk_score: float = Field(description="Score between 0.0 and 100.0")
    risk_level: str = Field(description="'High', 'Medium', 'Low', or 'Safe'")
    risk_flags: List[str] = Field(description="List of critical danger summaries", default_factory=list)

class NegotiationStrategy(BaseModel):
    counter_proposal: str = Field(description="Detailed strategy based on BATNA")

class DraftRevision(BaseModel):
    original_issue: str = Field(description="The original issue")
    neutral_rewrite: str = Field(description="Neutral B2B rewrite of the clause")

class DraftingResult(BaseModel):
    draft_revisions: List[DraftRevision] = Field(default_factory=list)

class ContractObligation(BaseModel):
    description: str = Field(description="Clear, concise description of the obligation")
    due_date: Optional[str] = Field(description="Deadline or date if mentioned, otherwise null", default=None)

class ObligationMinerResult(BaseModel):
    obligations: List[ContractObligation] = Field(default_factory=list)

class ClassifiedClause(BaseModel):
    clause_type: str = Field(description="Standard category from list")
    original_text: str = Field(description="Exact text excerpt")
    ai_summary: str = Field(description="1-2 sentence plain-English summary")

class ClauseClassifierResult(BaseModel):
    clauses: List[ClassifiedClause] = Field(default_factory=list)

# ==========================================
# 3. Agent 02: Compliance Agent
# ==========================================
def compliance_agent(state: ContractState) -> ContractState:
    """
    AGENT 02: Audits the extracted clauses for legal compliance.
    Returns: A list of compliance_issues.
    """
    print("[Agent 02: Compliance] Auditing clauses for compliance violations...")
    
    clauses = state.get('extracted_clauses', {})
    
    prompt = f"""
    You are a Senior Legal Compliance Auditor with strict corporate guidelines.
    Review the following extracted clauses and identify any risks. 
    CRITICAL CORPORATE PLAYBOOK RULES:
    1. ORDER OF PRECEDENCE TRAP: If this is an SOW or Addendum and it states it is subordinate to an MSA or external agreement (e.g., "ketentuan MSA yang berlaku"), FLAG THIS AS A COMPLIANCE ISSUE. It is a hidden risk because commercial terms might be overridden.
    2. MISSING TERMS: If the document is missing a clear termination clause, liability cap, or governing law, flag it.
    3. BIASED TERMS: Flag any heavily biased or commercially unreasonable terms.

    Return pure JSON with a single key 'compliance_issues' containing a list of strings detailing the issues. If none, return an empty list.
    
    CLAUSES:
    {json.dumps(clauses)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a legal compliance JSON generator."},
                {"role": "user", "content": prompt}
            ],
            response_format=ComplianceAudit
        )
        result = response.choices[0].message.parsed
        return {"compliance_issues": result.compliance_issues}
    except Exception as e:
        print(f"Compliance Agent Error: {e}")
        return {"compliance_issues": ["Error during compliance check."]}

# ==========================================
# 4. Agent 03: Risk Agent
# ==========================================
def risk_agent(state: ContractState) -> ContractState:
    """
    AGENT 03: Evaluates compliance issues to assign a risk score and flags.
    Returns: risk_score (0-100 float) and risk_flags (list of strings).
    """
    print("[Agent 03: Risk] Calculating overall contract risk score...")
    
    issues = state.get('compliance_issues', [])
    value = state.get('contract_value', 'Unknown')
    
    prompt = f"""
    You are a Chief Risk Officer AI.
    Evaluate the compliance issues and contract value.
    CRITICAL SCORING RULES:
    - If issues contain "Order of Precedence", "MSA subordination", or missing critical clauses, the 'risk_score' MUST be at least 50.0, and 'risk_level' MUST be 'Medium' or 'High'.
    - Only use 'Low' or 'Safe' if the contract is completely standalone, balanced, and contains zero compliance issues.

    1. Calculate a 'risk_score' (float 0.0 to 100.0).
    2. Determine a 'risk_level' (STRICTLY use: 'High', 'Medium', 'Low', or 'Safe').
       - 75-100 = 'High'
       - 40-74 = 'Medium'
       - 1-39 = 'Low'
       - 0 = 'Safe'
    3. Generate a list of 'risk_flags' summarizing the critical dangers.
    
    Return pure JSON with keys: 'risk_score' (float), 'risk_level' (string), and 'risk_flags' (list of strings).
    
    CONTRACT VALUE: {value}
    COMPLIANCE ISSUES:
    {json.dumps(issues)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a risk assessment JSON generator."},
                {"role": "user", "content": prompt}
            ],
            response_format=RiskAssessment
        )
        result = response.choices[0].message.parsed
        score = float(result.risk_score)
        risk_level = result.risk_level
        if not risk_level or risk_level not in ("High", "Medium", "Low", "Safe"):
            risk_level = "High" if score >= 75.0 else ("Medium" if score >= 40.0 else ("Low" if score > 0 else "Safe"))
        print(f"[Agent 03] Risk Score: {score}, Risk Level: {risk_level}")
        return {
            "risk_score": score,
            "risk_level": risk_level,
            "risk_flags": result.risk_flags
        }
    except Exception as e:
        print(f"Risk Agent Error: {e}")
        return {"risk_score": 100.0, "risk_level": "High", "risk_flags": ["Error calculating risk."]}

# ==========================================
# 5. Agent 04: Negotiation Strategy Agent
# ==========================================
def negotiation_agent(state: ContractState) -> ContractState:
    """
    AGENT 04: Analyzes compliance issues and risk flags to formulate a negotiation strategy based on BATNA.
    Returns: counter_proposal (string).
    """
    print("[Agent 04: Negotiation] Formulating BATNA-based negotiation strategy...")
    
    issues = state.get('compliance_issues', [])
    flags = state.get('risk_flags', [])
    
    prompt = f"""
    You are an expert Corporate Negotiation Strategist.
    Analyze the following compliance issues and risk flags and formulate a BATNA-based (Best Alternative to a Negotiated Agreement) strategy on how to negotiate these points with the counterparty.
    Provide a robust, professional counter_proposal strategy.
    
    Return pure JSON with a single key 'counter_proposal' mapping to a detailed string containing the strategy.
    
    COMPLIANCE ISSUES:
    {json.dumps(issues)}
    RISK FLAGS:
    {json.dumps(flags)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a strategic negotiation JSON generator."},
                {"role": "user", "content": prompt}
            ],
            response_format=NegotiationStrategy
        )
        result = response.choices[0].message.parsed
        return {"counter_proposal": result.counter_proposal}
    except Exception as e:
        print(f"Negotiation Agent Error: {e}")
        return {"counter_proposal": "Error formulating negotiation strategy."}

# ==========================================
# 6. Agent 05: Contract Drafting Agent
# ==========================================
def drafting_agent(state: ContractState) -> ContractState:
    """
    AGENT 05: Based on the negotiation strategy, rewrites risky clauses into Fair/Neutral versions.
    Returns: draft_revisions (list of dicts).
    """
    print("[Agent 05: Drafting] Rewriting risky clauses to neutral/fair versions...")
    
    strategy = state.get('counter_proposal', '')
    issues = state.get('compliance_issues', [])
    
    prompt = f"""
    You are a Senior Contract Drafter.
    Based on the following negotiation strategy and compliance issues, rewrite the problematic clauses into "Fair/Neutral" B2B versions.
    
    Return pure JSON with a single key 'draft_revisions' mapping to a list of dicts. Each dict should have 'original_issue' (string) and 'neutral_rewrite' (string).
    
    NEGOTIATION STRATEGY: {strategy}
    COMPLIANCE ISSUES:
    {json.dumps(issues)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a legal contract drafting JSON generator."},
                {"role": "user", "content": prompt}
            ],
            response_format=DraftingResult
        )
        result = response.choices[0].message.parsed
        return {"draft_revisions": [r.model_dump() for r in result.draft_revisions]}
    except Exception as e:
        print(f"Drafting Agent Error: {e}")
        return {"draft_revisions": [{"error": "Failed to draft revisions."}]}

# ==========================================
# 7. Agent 06: Obligation Miner
# ==========================================
def obligation_miner_agent(state: ContractState) -> ContractState:
    """
    AGENT 06: Mines the raw document for contractual obligations,
    deliverables, duties, and commitments (shall, must, agrees to).
    Returns: extracted_obligations (list of dicts with description and due_date).
    """
    print("[Agent 06: Obligation Miner] Extracting contractual obligations...")

    prompt = f"""
    You are an expert Legal Obligation Analyst.
    Analyze the following contract text and extract ALL contractual obligations,
    deliverables, duties, and commitments. Look for keywords like "shall", "must",
    "agrees to", "is required to", "will", "undertakes to", "covenants".

    For each obligation found, extract:
    - 'description': A clear, concise description of the obligation.
    - 'due_date': The specific deadline or date if mentioned (e.g., "2025-06-30"). If no date is mentioned, use null.

    Return pure JSON with a single key 'obligations' containing a list of objects.
    Each object must have 'description' (string) and 'due_date' (string or null).
    If no obligations are found, return an empty list.

    CONTRACT TEXT:
    {state.get('raw_document', '')}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a precise obligation extraction JSON engine."},
                {"role": "user", "content": prompt}
            ],
            response_format=ObligationMinerResult
        )
        result = response.choices[0].message.parsed
        return {"extracted_obligations": [dict(o) for o in result.obligations]}
    except Exception as e:
        print(f"Obligation Miner Error: {e}")
        return {"extracted_obligations": []}

# ==========================================
# 8. Agent 07: Clause Classifier
# ==========================================
def clause_classifier_agent(state: ContractState) -> ContractState:
    """
    AGENT 07: Classifies key clauses from the contract into standard legal categories
    (Indemnity, Termination, Payment, Survival, Confidentiality, etc.)
    and extracts the original text + AI summary for each.
    Returns: classified_clauses (list of dicts).
    """
    print("[Agent 07: Clause Classifier] Classifying key contract clauses...")

    clauses = state.get('extracted_clauses', {})

    prompt = f"""
    You are an expert Legal Clause Classifier.
    Review the following extracted clauses from a contract and classify each one into
    a standard legal category.

    Valid categories: 'Indemnity', 'Payment', 'Termination', 'Survival',
    'Confidentiality', 'Liability', 'Force Majeure', 'Governing Law',
    'Dispute Resolution', 'Intellectual Property', 'Non-Compete', 'Other'.

    For each clause, provide:
    - 'clause_type': One of the valid categories above.
    - 'original_text': The exact text or excerpt of this clause.
    - 'ai_summary': A 1-2 sentence plain-English summary of what this clause means.

    Return pure JSON with a single key 'clauses' containing a list of objects.
    Each object must have 'clause_type' (string), 'original_text' (string), and 'ai_summary' (string).

    EXTRACTED CLAUSES:
    {json.dumps(clauses)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a legal clause classification JSON engine."},
                {"role": "user", "content": prompt}
            ],
            response_format=ClauseClassifierResult
        )
        result = response.choices[0].message.parsed
        return {"classified_clauses": [dict(c) for c in result.clauses]}
    except Exception as e:
        print(f"Clause Classifier Error: {e}")
        return {"classified_clauses": []}

# ==========================================
# 9. Graph Orchestration
# ==========================================
# Initialize the StateGraph with our ContractState
workflow = StateGraph(ContractState)

# Add the agent nodes to the graph
workflow.add_node("ingestion", ingestion_agent)
workflow.add_node("compliance", compliance_agent)
workflow.add_node("risk", risk_agent)
workflow.add_node("negotiation", negotiation_agent)
workflow.add_node("drafting", drafting_agent)
workflow.add_node("obligation_miner", obligation_miner_agent)
workflow.add_node("clause_classifier", clause_classifier_agent)

# Define the sequential execution flow (7-Agent Pipeline)
workflow.add_edge(START, "ingestion")
workflow.add_edge("ingestion", "compliance")
workflow.add_edge("compliance", "risk")
workflow.add_edge("risk", "negotiation")
workflow.add_edge("negotiation", "drafting")
workflow.add_edge("drafting", "obligation_miner")
workflow.add_edge("obligation_miner", "clause_classifier")
workflow.add_edge("clause_classifier", END)

# Compile the graph into an executable application
try:
    clm_graph = workflow.compile()
    print("LangGraph CLM 7-Agent Orchestration initialized successfully.")
except Exception as e:
    print(f"FATAL: Failed to compile LangGraph: {e}")
    clm_graph = None
