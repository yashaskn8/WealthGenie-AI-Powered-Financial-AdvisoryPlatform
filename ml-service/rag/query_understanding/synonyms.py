"""
WealthGenie RAG Subsystem - Financial Synonym & Term Expander
Maps key financial concepts, tax sections, and regulatory acronyms to rich domain synonyms
to boost vector and BM25 search recall.
"""

import re
from typing import Dict, List

# Retrieval-only vocabulary. Values intentionally contain no rates, thresholds,
# exemptions, return assumptions, or statutory conclusions.
FINANCIAL_SYNONYMS: Dict[str, str] = {
    "80C": "tax statute section provision historical applicable tax period",
    "80D": "health insurance tax statute provision historical applicable tax period",
    "80CCD": "pension contribution tax statute provision historical applicable tax period",
    "80CCD(1B)": "pension contribution tax statute provision historical applicable tax period",
    "LTCG": "long term capital gains tax statutory treatment applicable period",
    "STCG": "short term capital gains tax statutory treatment applicable period",
    "DICGC": "deposit insurance Credit Guarantee Corporation official coverage rules",
    "SGB": "Sovereign Gold Bond official issuance redemption and tax rules",
    "HRA": "house rent allowance statutory tax treatment applicable period",
    "ELSS": "equity linked savings scheme official regulatory classification",
    "NPS": "National Pension System official statutory treatment applicable period",
    "PPF": "Public Provident Fund official scheme rules and applicable period",
    "RISKOMETER": "SEBI mutual fund riskometer official risk classification",
    "REBATE": "income tax rebate statutory rule applicable period",
    "87A": "income tax statute rule identifier historical or current law must be verified",
    "SLAB": "income tax slabs statutory rates and applicable tax period",
    "SLABS": "income tax slabs statutory rates and applicable tax period",
}


class SynonymExpander:
    """Enriches user query strings with authoritative financial term synonym expansions."""

    def __init__(self, synonym_map: Dict[str, str] = None):
        self.synonym_map = synonym_map or FINANCIAL_SYNONYMS

    def expand_synonyms(self, query: str) -> str:
        """
        Identifies key financial concepts in query and appends domain synonyms.
        """
        if not query:
            return ""

        query_lower = query.lower()
        expansions: List[str] = []

        for key, expansion in self.synonym_map.items():
            # Check exact term or word match in query
            key_pattern = r"\b" + re.escape(key.lower()) + r"\b"
            if re.search(key_pattern, query_lower):
                # Avoid duplicating terms already present in query
                new_words = [
                    w for w in expansion.split()
                    if w.lower() not in query_lower and w not in expansions
                ]
                if new_words:
                    expansions.extend(new_words)

        if expansions:
            return f"{query} {' '.join(expansions)}"
        return query
