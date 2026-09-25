"""
WealthGenie RAG Subsystem - Query Rewriter
Rewrites and expands queries for improved vector search matching.
"""



class QueryRewriter:
    """Rewrites queries by enriching key terms and appending financial context tags."""

    def rewrite(self, query: str, intent: str = "general_advisory") -> str:
        """Enriches user query text based on intent category."""
        if not query:
            return ""

        rewritten = query.strip()

        # Expand only domain vocabulary. Statutory periods and rule identifiers
        # must come from current manifest-backed evidence, never query defaults.
        if intent == "asset_suitability" and "investment" not in rewritten.lower():
            rewritten += " Investment Asset Risk Classification"

        return rewritten
