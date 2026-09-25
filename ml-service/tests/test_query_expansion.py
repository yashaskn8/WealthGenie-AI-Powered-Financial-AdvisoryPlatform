"""
Unit tests for financial synonym query expansion in QueryUnderstandingPipeline.
Verifies expansion of terms like '80C', 'LTCG', 'DICGC', 'SGB', 'HRA', etc.
"""

from rag.query_understanding.pipeline import QueryUnderstandingPipeline
from rag.query_understanding.synonyms import SynonymExpander


def test_synonym_expander_80c_does_not_invent_current_tax_rules():
    """Legacy section identifiers are expanded only into period-qualified terms."""
    expander = SynonymExpander()
    query = "What is the maximum limit under 80C?"
    result = expander.expand_synonyms(query)
    assert "80C" in result
    assert "historical" in result
    assert "maximum deduction" not in result


def test_synonym_expander_ltcg():
    """Verifies expansion of 'LTCG' with capital gains terms."""
    expander = SynonymExpander()
    query = "How is LTCG taxed on equity funds?"
    result = expander.expand_synonyms(query)
    assert "long term capital gains" in result
    assert "applicable period" in result
    assert "12.5%" not in result


def test_synonym_expander_dicgc():
    """Verifies expansion of 'DICGC' with deposit insurance details."""
    expander = SynonymExpander()
    query = "Is my savings account insured by DICGC?"
    result = expander.expand_synonyms(query)
    assert "deposit insurance" in result.lower()
    assert "5 lakh" not in result.lower()


def test_synonym_expander_sgb():
    """Verifies expansion of 'SGB' with sovereign gold bond terms."""
    expander = SynonymExpander()
    query = "What is the interest rate on SGB?"
    result = expander.expand_synonyms(query)
    assert "sovereign gold bond" in result.lower()
    assert "official" in result.lower()
    assert "2.5%" not in result


def test_query_understanding_pipeline_end_to_end_expansion():
    """Verifies end-to-end processing pipeline produces enriched search_query."""
    pipeline = QueryUnderstandingPipeline()
    res = pipeline.process("How much tax do I save with 50k in 80CCD?")

    assert "search_query" in res
    assert "synonym_expanded_query" in res
    search_q = res["search_query"]
    assert "80CCD" in search_q or "NPS" in search_q or "national pension" in search_q.lower()
    assert "additional deduction" in search_q or "50k" in search_q
