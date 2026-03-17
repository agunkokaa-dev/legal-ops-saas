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
    contract_value: str           # Financial value or consideration found
    end_date: str                 # Termination or expiry date
    effective_date: str           # Date the agreement goes into effect
    jurisdiction: str             # Legal jurisdiction
    governing_law: str            # Governing law
    compliance_issues: Annotated[list, operator.add]  # List of legal/compliance violations found
    risk_flags: Annotated[list, operator.add]          # Specific risk warnings
    risk_score: float             # Calculated risk score (0-100)
    counter_proposal: str         # Negotiation strategy / BATNA reasoning
    draft_revisions: Annotated[list, operator.add]     # Revised neutral/fair clauses
    extracted_obligations: Annotated[list, operator.add]  # Obligations mined from contract
    classified_clauses: Annotated[list, operator.add]     # Key clauses classified by type

# ==========================================
# 2. Agent 01: Ingestion Agent
# ==========================================
def ingestion_agent(state: ContractState) -> ContractState:
    """
    AGENT 01: Parses the raw document to extract key metadata and clauses.
    Returns: contract_value, end_date, and populated extracted_clauses.
    """
    print(f"[Agent 01: Ingestion] Processing contract: {state.get('contract_id', 'Unknown')}")
    
    prompt = f"""
    You are an expert Legal Document Parser.
    Extract the following from the provided contract text:
    1. 'contract_value': The total financial consideration or value. If none, say "Not Specified".
    2. 'end_date': The termination date or duration. If none, say "Not Specified".
    3. 'effective_date': The date the agreement goes into effect. Look for phrases like 'Effective Date', 'Tanggal Efektif', or use the date the agreement is signed. If none, return null.
    4. 'jurisdiction': The legal jurisdiction of the contract. If none, return null.
    5. 'governing_law': The governing law of the contract. If none, return null.
    6. 'extracted_clauses': A dictionary where keys are clause names (e.g., 'Indemnity', 'Liability', 'Termination') and values are the exact text or a summary.
    
    Return pure JSON with keys: 'contract_value', 'end_date', 'effective_date', 'jurisdiction', 'governing_law', 'extracted_clauses'.
    
    CONTRACT TEXT:
    {state.get('raw_document', '')[:10000]} # Truncated for safety
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a precise JSON legal extraction engine."},
                {"role": "user", "content": prompt}
            ]
        )
        result = json.loads(response.choices[0].message.content)
        return {
            "contract_value": result.get("contract_value", "Unknown"),
            "end_date": result.get("end_date", "Unknown"),
            "effective_date": result.get("effective_date", None),
            "jurisdiction": result.get("jurisdiction", None),
            "governing_law": result.get("governing_law", None),
            "extracted_clauses": result.get("extracted_clauses", {})
        }
    except Exception as e:
        print(f"Ingestion Agent Error: {e}")
        return {"contract_value": "Error", "end_date": "Error", "effective_date": None, "jurisdiction": None, "governing_law": None, "extracted_clauses": {}}

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
    You are a Senior Legal Compliance Auditor.
    Review the following extracted clauses and identify any that are illegal, heavily biased, commercially unreasonable, or violate standard B2B compliance.
    
    Return pure JSON with a single key 'compliance_issues' containing a list of strings detailing the issues. If none, return an empty list.
    
    CLAUSES:
    {json.dumps(clauses)}
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a legal compliance JSON generator."},
                {"role": "user", "content": prompt}
            ]
        )
        result = json.loads(response.choices[0].message.content)
        return {"compliance_issues": result.get("compliance_issues", [])}
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
    Evaluate the following compliance issues and the contract value to determine the risk.
    Calculate a 'risk_score' as a float from 0.0 (perfectly safe) to 100.0 (extreme risk).
    Generate a list of 'risk_flags' summarizing the critical dangers.
    
    Return pure JSON with keys: 'risk_score' (float) and 'risk_flags' (list of strings).
    
    CONTRACT VALUE: {value}
    COMPLIANCE ISSUES:
    {json.dumps(issues)}
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a risk assessment JSON generator."},
                {"role": "user", "content": prompt}
            ]
        )
        result = json.loads(response.choices[0].message.content)
        return {
            "risk_score": float(result.get("risk_score", 0.0)),
            "risk_flags": result.get("risk_flags", [])
        }
    except Exception as e:
        print(f"Risk Agent Error: {e}")
        return {"risk_score": 100.0, "risk_flags": ["Error calculating risk."]}

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
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a strategic negotiation JSON generator."},
                {"role": "user", "content": prompt}
            ]
        )
        result = json.loads(response.choices[0].message.content)
        return {"counter_proposal": result.get("counter_proposal", "No strategy formulated.")}
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
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a legal contract drafting JSON generator."},
                {"role": "user", "content": prompt}
            ]
        )
        result = json.loads(response.choices[0].message.content)
        return {"draft_revisions": result.get("draft_revisions", [])}
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
    {state.get('raw_document', '')[:12000]}
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a precise obligation extraction JSON engine."},
                {"role": "user", "content": prompt}
            ]
        )
        result = json.loads(response.choices[0].message.content)
        return {"extracted_obligations": result.get("obligations", [])}
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
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a legal clause classification JSON engine."},
                {"role": "user", "content": prompt}
            ]
        )
        result = json.loads(response.choices[0].message.content)
        return {"classified_clauses": result.get("clauses", [])}
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
