import time

from app.ai_usage import log_openai_response_sync
from app.bilingual_schemas import BilingualConsistencyReport, BilingualFinding
from app.config import OUTPUT_TOKEN_CAPS, admin_supabase, openai_client

def run_bilingual_consistency_agent(
    clauses: list[dict],
    tenant_id: str | None = None,
    contract_id: str | None = None,
) -> BilingualConsistencyReport:
    """Runs zero-shot structural checks and semantic equivalence evaluation on bilingual clauses."""
    
    prompt = "Review the following bilingual clauses for semantic consistency and legal equivalence under Indonesian law.\n\n"
    for c in clauses:
        prompt += f"--- Clause {c['clause_number']} ---\n"
        prompt += f"ID: {c.get('id_text', '')}\n"
        prompt += f"EN: {c.get('en_text', '')}\n\n"
        
    system_prompt = (
        "You are a rigorous bilingual contract analysis agent. "
        "Review each clause mapped between Bahasa Indonesia and English. "
        "If they match precisely in legal intent and scope, your overall score should be high. "
        "If there are contradictions, missing conditions, or divergent structures, flag a finding."
    )
    
    try:
        started_at = time.perf_counter()
        response = openai_client.beta.chat.completions.parse(
             model="gpt-4o",
             max_tokens=OUTPUT_TOKEN_CAPS["bilingual"],
             messages=[
                  {"role": "system", "content": system_prompt},
                  {"role": "user", "content": prompt}
             ],
             response_format=BilingualConsistencyReport
        )
        log_openai_response_sync(
            admin_supabase,
            tenant_id,
            "bilingual_validate",
            "gpt-4o",
            response,
            int((time.perf_counter() - started_at) * 1000),
            contract_id=contract_id,
            metadata={"clause_count": len(clauses)},
        )
        return response.choices[0].message.parsed
    except Exception as e:
        print(f"Error in bilingual_agent: {e}")
        raise e
