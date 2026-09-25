"""
WealthGenie RAG Subsystem - Query Understanding Test Suite
Tests Normalizer, SpellingCorrector, AcronymExpander, IntentClassifier, Rewriter, and QueryUnderstandingPipeline.
"""

from rag.query_understanding.acronyms import AcronymExpander
from rag.query_understanding.intent import QueryIntentClassifier
from rag.query_understanding.normalizer import QueryNormalizer
from rag.query_understanding.pipeline import QueryUnderstandingPipeline
from rag.query_understanding.rewriter import QueryRewriter
from rag.query_understanding.spelling import SpellingCorrector


def test_query_normalizer():
    normalizer = QueryNormalizer()
    res = normalizer.normalize("  What   is Section 87A?  \n ")
    assert res == "What is Section 87A?"


def test_spelling_corrector():
    corrector = SpellingCorrector()
    res = corrector.correct("What is the tax rebte and detuction limit?")
    assert "rebate" in res
    assert "deduction" in res


def test_acronym_expander():
    expander = AcronymExpander()
    res = expander.expand("How much can I invest in ELSS and NPS under Section 80C?")
    assert "Equity Linked Savings Scheme" in res
    assert "National Pension System" in res


def test_query_intent_classifier():
    classifier = QueryIntentClassifier()

    tax_intent = classifier.classify("What is the tax slab for New Tax Regime FY 2025-26?")
    assert tax_intent["primary_intent"] == "tax_regime"

    deduction_intent = classifier.classify("How much deduction is allowed under Section 80C and 80D?")
    assert deduction_intent["primary_intent"] == "deduction"

    asset_intent = classifier.classify("Is ELSS mutual fund suitable for long term equity investment?")
    assert asset_intent["primary_intent"] == "asset_suitability"


def test_query_rewriter():
    rewriter = QueryRewriter()
    res = rewriter.rewrite("What is the rebate slab?", intent="tax_regime")
    assert res == "What is the rebate slab?"
    assert "FY 2025-26" not in res


def test_query_understanding_pipeline():
    pipeline = QueryUnderstandingPipeline()
    res = pipeline.process("What is the tax rebte limit for ELSS under 80c?")

    assert res["raw_query"] == "What is the tax rebte limit for ELSS under 80c?"
    assert "rebate" in res["corrected_query"]
    assert "Equity Linked Savings Scheme" in res["expanded_query"]
    assert res["intent"] in ["tax_regime", "deduction", "asset_suitability"]
    assert "search_query" in res
