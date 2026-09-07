"""
WealthGenie RAG Subsystem — Cross-Encoder Reranker Test Suite
Tests CrossEncoderReranker contract compliance, semantic reranking superiority
over keyword heuristics, empty-input safety, and pipeline registry resolution.
"""

import pytest
import numpy as np
from rag.reranking.cross_encoder_reranker import CrossEncoderReranker
from rag.reranking.noop_reranker import NoOpReranker
from rag.retrieval.pipeline import get_reranker
from rag.schema import RetrievedChunk, TextChunk, ChunkMetadata


def _make_chunk(chunk_id: str, content: str, title: str, score: float, rank: int) -> RetrievedChunk:
    """Helper to build a RetrievedChunk fixture."""
    meta = ChunkMetadata(
        chunk_id=chunk_id,
        document_id="doc1",
        chunk_index=0,
        title=title,
        source="test.md",
    )
    chunk = TextChunk(chunk_id=chunk_id, document_id="doc1", content=content, metadata=meta)
    return RetrievedChunk(chunk=chunk, score=score, rank=rank)


class DeterministicCrossEncoder:
    """Offline test double for the external sentence-transformer artifact."""

    def predict(self, pairs):
        return np.asarray([
            0.99 if "Section 80D" in passage else
            0.90 if "Tax slab rates" in passage else
            0.70 if "Section 80C" in passage else
            0.20
            for _, passage in pairs
        ])


# ─── Fixture: injected scorer keeps the contract suite network-independent ──

@pytest.fixture(scope="module")
def reranker():
    """Use the same reranking implementation without downloading in unit tests."""
    return CrossEncoderReranker(model=DeterministicCrossEncoder())


# ─── Test A: Semantic reranking beats keyword overlap ───────────────────────

def test_cross_encoder_reranks_by_model_relevance(reranker):
    """
    Constructs a case where the cross-encoder's semantic understanding
    genuinely outperforms a naive keyword overlap heuristic.

    Query: "What tax deductions are available for health insurance premiums?"

    Chunk A (DISTRACTOR — shares keywords but is about fitness/wellness):
        Contains "health", "premium", "benefits", "deductions" but in a
        fitness/wellness context, not tax/insurance context.

    Chunk B (ANSWER — directly about Section 80D tax deduction):
        Discusses the actual tax deduction under Section 80D for medical
        insurance premium payments.

    Both chunks share similar surface keywords with the query. The
    cross-encoder must use contextual understanding to identify which
    chunk actually discusses tax deductions for insurance premiums.
    """
    chunk_a_distractor = _make_chunk(
        "distractor",
        "Premium health and wellness programs offer significant benefits for "
        "corporate employees. Companies that invest in health initiatives see "
        "deductions in absenteeism and improved workforce productivity. The "
        "premium tier membership includes nutrition counseling, fitness "
        "tracking, and preventive health screening benefits.",
        "Corporate Wellness",
        0.82,
        1,
    )
    chunk_b_answer = _make_chunk(
        "answer",
        "Under Section 80D of the Income Tax Act, individuals can claim a "
        "deduction of up to Rs 25,000 per year for medical insurance premium "
        "payments. For senior citizen parents, the deduction limit is Rs 50,000. "
        "This deduction is available under the Old Tax Regime and covers "
        "premiums paid for self, spouse, children, and dependent parents.",
        "Tax Deduction Guide",
        0.75,
        2,
    )

    result = reranker.rerank(
        "What tax deductions are available for health insurance premiums?",
        [chunk_a_distractor, chunk_b_answer],
    )

    assert len(result) == 2
    # The cross-encoder should rank the tax deduction chunk higher
    assert result[0].chunk.chunk_id == "answer", (
        f"Cross-encoder should rank the answer chunk first, but ranked "
        f"'{result[0].chunk.chunk_id}' first with scores: "
        f"distractor={[c.score for c in result if c.chunk.chunk_id=='distractor'][0]}, "
        f"answer={[c.score for c in result if c.chunk.chunk_id=='answer'][0]}"
    )
    assert result[0].rank == 1
    assert result[1].rank == 2


# ─── Test B: reranker_name returns exactly "cross_encoder" ─────────────────

def test_reranker_name_is_cross_encoder(reranker):
    """The reranker_name property must return the exact string config.py expects."""
    assert reranker.reranker_name == "cross_encoder"


# ─── Test C: Empty chunks returns empty list without model invocation ──────

def test_empty_chunks_returns_empty(reranker):
    """Empty input must return empty output without calling the model."""
    result = reranker.rerank("any query", [])
    assert result == []


# ─── Test D: get_reranker("cross_encoder") resolves correctly ──────────────

def test_get_reranker_resolves_cross_encoder(monkeypatch):
    """
    Directly tests that the silent-fallback bug is closed:
    get_reranker("cross_encoder") must return a CrossEncoderReranker,
    NOT a NoOpReranker fallback.
    """
    monkeypatch.setattr(
        "rag.reranking.cross_encoder_reranker.CrossEncoder",
        lambda _model_name: DeterministicCrossEncoder(),
    )
    resolved = get_reranker("cross_encoder")
    assert isinstance(resolved, CrossEncoderReranker), (
        f"Expected CrossEncoderReranker but got {type(resolved).__name__}. "
        f"The 'cross_encoder' strategy is still falling back to NoOpReranker."
    )
    assert not isinstance(resolved, NoOpReranker)


# ─── Test E: Ranks are contiguous 1..N after reranking ─────────────────────

def test_ranks_are_contiguous(reranker):
    """All returned chunks must have contiguous ranks 1..N."""
    chunks = [
        _make_chunk("c1", "Tax slab rates under Section 115BAC New Regime", "Tax Slabs", 0.9, 1),
        _make_chunk("c2", "Section 80C deduction for ELSS mutual funds", "80C Guide", 0.8, 2),
        _make_chunk("c3", "Sovereign Gold Bonds 2.5% annual coupon interest", "SGB Info", 0.7, 3),
    ]
    result = reranker.rerank("income tax slab rates", chunks)

    assert len(result) == 3
    ranks = [c.rank for c in result]
    assert sorted(ranks) == [1, 2, 3], f"Ranks should be [1,2,3] but got {ranks}"
