"""
WealthGenie RAG Subsystem - Document Loaders
Parses Markdown, Plain Text, HTML, CSV, and PDF documents into canonical Document models.
"""

import csv
import hashlib
import re
from pathlib import Path
from typing import Optional

from rag.schema import Document, DocumentMetadata


class DocumentLoaderError(ValueError):
    """Raised when a document cannot be parsed or loaded."""
    pass


class DocumentLoader:
    """Unified document loader supporting MD, TXT, HTML, CSV, and PDF formats."""

    @staticmethod
    def compute_doc_id(content: str, source_path: str) -> str:
        """Computes deterministic SHA256 identifier for document content and path."""
        hasher = hashlib.sha256()
        hasher.update(source_path.encode("utf-8"))
        hasher.update(content.encode("utf-8"))
        return hasher.hexdigest()[:16]

    def load_file(
        self,
        file_path: Path,
        title: Optional[str] = None,
        author: Optional[str] = None,
        effective_date: Optional[str] = None,
        source_trust_tier: Optional[str] = None,
        tenant_id: str = "default",
        scope: str = "global",
    ) -> Document:
        """Loads a document file from disk based on extension."""
        if not file_path.exists():
            raise DocumentLoaderError(f"File not found at path: {file_path}")

        ext = file_path.suffix.lower()
        source = str(file_path.name)
        doc_title = title or file_path.stem.replace("_", " ").title()

        if ext in [".md", ".markdown"]:
            content = file_path.read_text(encoding="utf-8")
            doc_type = "markdown"
        elif ext in [".txt"]:
            content = file_path.read_text(encoding="utf-8")
            doc_type = "text"
        elif ext in [".html", ".htm"]:
            raw_html = file_path.read_text(encoding="utf-8")
            content = re.sub(r"<[^>]+>", " ", raw_html)
            content = re.sub(r"\s+", " ", content).strip()
            doc_type = "html"
        elif ext in [".csv"]:
            content = self._load_csv(file_path)
            doc_type = "csv"
        elif ext in [".pdf"]:
            content = self._load_pdf(file_path)
            doc_type = "pdf"
        else:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            doc_type = "text"

        doc_id = self.compute_doc_id(content, str(file_path))
        meta_kwargs = {
            "title": doc_title,
            "source": source,
            "document_type": doc_type,
            "author": author or "Authoritative Financial Source",
            "tenant_id": tenant_id,
            "scope": scope,
        }
        if effective_date:
            meta_kwargs["effective_date"] = effective_date
        if source_trust_tier:
            meta_kwargs["source_trust_tier"] = source_trust_tier

        metadata = DocumentMetadata(**meta_kwargs)
        return Document(document_id=doc_id, content=content, metadata=metadata)

    def load_text(
        self,
        text: str,
        title: str,
        source: str = "direct_input",
        author: Optional[str] = None,
        effective_date: Optional[str] = None,
        source_trust_tier: Optional[str] = None,
        tenant_id: str = "default",
        scope: str = "global",
    ) -> Document:
        """Loads a raw text string directly as a Document."""
        doc_id = self.compute_doc_id(text, source)
        meta_kwargs = {
            "title": title,
            "source": source,
            "document_type": "text",
            "author": author or "Financial Advisor",
            "tenant_id": tenant_id,
            "scope": scope,
        }
        if effective_date:
            meta_kwargs["effective_date"] = effective_date
        if source_trust_tier:
            meta_kwargs["source_trust_tier"] = source_trust_tier

        metadata = DocumentMetadata(**meta_kwargs)
        return Document(document_id=doc_id, content=text, metadata=metadata)

    def _load_csv(self, file_path: Path) -> str:
        """Parses CSV rows into formatted text lines."""
        rows = []
        with open(file_path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            headers = next(reader, None)
            if headers:
                rows.append(" | ".join(headers))
            for row in reader:
                rows.append(" | ".join(row))
        return "\n".join(rows)

    def _load_pdf(self, file_path: Path) -> str:
        """Attempts to extract text from PDF using pypdf/fitz or falls back to raw text extraction."""
        try:
            import pypdf
            reader = pypdf.PdfReader(file_path)
            text_pages = [page.extract_text() for page in reader.pages if page.extract_text()]
            return "\n\n".join(text_pages)
        except ImportError:
            # Fallback text extraction
            raw = file_path.read_bytes()
            extracted = re.sub(r"[^\x20-\x7E\n]", " ", raw.decode("latin1", errors="ignore"))
            return re.sub(r"\s+", " ", extracted).strip()
