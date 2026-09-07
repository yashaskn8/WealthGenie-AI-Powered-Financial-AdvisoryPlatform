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

        # Add domain contextual tags based on intent
        if intent == "tax_regime" and "fy 2025-26" not in rewritten.lower():
            rewritten += " Indian Income Tax FY 2025-26"
        elif intent == "deduction" and "section" not in rewritten.lower():
            rewritten += " Tax Deductions Section 80C 80D"
        elif intent == "asset_suitability" and "sebi" not in rewritten.lower():
            rewritten += " Investment Asset Risk Classification"

        return rewritten
