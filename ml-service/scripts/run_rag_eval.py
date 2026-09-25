"""Compatibility entry point for the one canonical current-corpus RAG evaluator.

The old script embedded a second synthetic and historically stale knowledge base.
Keep its command path for existing operators, but delegate all evaluation to the
manifest-backed evaluator used by the RAG service.
"""

import sys
from pathlib import Path

_ml_service_root = Path(__file__).resolve().parents[1]
if str(_ml_service_root) not in sys.path:
    sys.path.insert(0, str(_ml_service_root))

from rag.evaluation.run_benchmark import main


if __name__ == "__main__":
    main()
