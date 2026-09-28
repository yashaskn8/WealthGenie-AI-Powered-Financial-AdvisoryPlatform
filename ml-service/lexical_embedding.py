"""Small, process-stable lexical embedding helper.

This module intentionally avoids importing the full ML/RAG application so
cross-process determinism checks do not initialize the semantic model stack.
"""

import hashlib
import math
import re
from typing import List

import numpy as np


def tokenize_subwords(text: str) -> List[str]:
    """Return the lexical fallback's versioned word/prefix/suffix tokens."""
    cleaned = re.sub(r"[^\w\s]", " ", text.lower())
    tokens = cleaned.split()
    ngrams = []
    for token in tokens:
        ngrams.append(token)
        if len(token) >= 4:
            ngrams.extend((token[:3], token[-3:]))
    return ngrams


def stable_lexical_embedding(text: str, dimension: int) -> List[float]:
    """Create a deterministic normalized SHA-256 n-gram vector."""
    if not isinstance(dimension, int) or isinstance(dimension, bool) or dimension <= 0:
        raise ValueError("dimension must be a positive integer")

    vector = np.zeros(dimension, dtype=np.float32)
    for token in tokenize_subwords(text):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:8], byteorder="big", signed=False) % dimension
        vector[bucket] += math.log1p(len(token))

    norm = np.linalg.norm(vector)
    if norm:
        vector = vector / norm
    return vector.tolist()
