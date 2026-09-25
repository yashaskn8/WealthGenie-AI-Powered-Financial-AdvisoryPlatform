"""Shared, transaction-backed RAG document lifecycle state for production."""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo.errors import DuplicateKeyError, OperationFailure

from rag.schema import Document, TextChunk, is_scope_accessible


class MongoRAGLifecycleStore:
    """Own document revisions and their chunks in the same Mongo transaction."""

    is_shared = True

    def __init__(self, client: Any, database: Any, vector_collection: str = "vector_chunks"):
        self.client = client
        self.database = database
        self.revisions = database["rag_document_revisions"]
        self.chunks = database[vector_collection]
        self.state = database["rag_state"]

    def commit_document_revision(self, document: Document, chunks: list[TextChunk]) -> dict[str, Any]:
        scope = document.metadata.scope or "global"
        tenant_id = document.metadata.tenant_id or "default"
        owner = document.metadata.custom_metadata.get("owner_user_id")
        if not owner and scope.startswith("user:"):
            owner = scope[5:]
        revision_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        identity = {"document_id": document.document_id, "scope": scope}
        try:
            with self.client.start_session() as session:
                with session.start_transaction():
                    previous = self.revisions.find_one(
                        {**identity, "lifecycle_state": "ACTIVE"}, session=session
                    )
                    latest = self.revisions.find_one(
                        identity, sort=[("version_number", -1)], session=session
                    )
                    version = int(latest.get("version_number", 0)) + 1 if latest else 1
                    revision = self._revision_document(
                        document, revision_id, version, len(chunks), owner, now, "PENDING"
                    )
                    self.revisions.insert_one(revision, session=session)
                    documents = []
                    for position, chunk in enumerate(chunks):
                        payload = chunk.model_dump()
                        unique_chunk_id = f"{chunk.chunk_id}@{revision_id}"
                        payload["chunk_id"] = unique_chunk_id
                        payload["metadata"]["chunk_id"] = unique_chunk_id
                        payload.update({
                            "document_revision_id": revision_id,
                            "corpus_generation_id": revision_id,
                            "lifecycle_state": "PENDING",
                            "revision_chunk_index": position,
                            "scope": scope,
                            "tenant_id": tenant_id,
                        })
                        documents.append(payload)
                    if len(documents) != len(chunks) or not documents:
                        raise ValueError("document revision has no complete chunk set")
                    self.chunks.insert_many(documents, ordered=True, session=session)
                    stored_count = self.chunks.count_documents(
                        {"document_revision_id": revision_id}, session=session
                    )
                    if stored_count != len(chunks):
                        raise RuntimeError("document revision chunk set is incomplete")
                    if previous:
                        self.revisions.update_one(
                            {"document_revision_id": previous["document_revision_id"], "lifecycle_state": "ACTIVE"},
                            {"$set": {"lifecycle_state": "SUPERSEDED", "updated_at_utc": now}},
                            session=session,
                        )
                        self.chunks.update_many(
                            {"document_revision_id": previous["document_revision_id"]},
                            {"$set": {"lifecycle_state": "SUPERSEDED"}},
                            session=session,
                        )
                    self.chunks.update_many(
                        {"document_revision_id": revision_id, "lifecycle_state": "PENDING"},
                        {"$set": {"lifecycle_state": "ACTIVE"}},
                        session=session,
                    )
                    activated_chunks = self.chunks.count_documents(
                        {"document_revision_id": revision_id, "lifecycle_state": "ACTIVE"},
                        session=session,
                    )
                    if activated_chunks != len(chunks):
                        raise RuntimeError("document revision failed active chunk validation")
                    self.revisions.update_one(
                        {"document_revision_id": revision_id, "lifecycle_state": "PENDING"},
                        {"$set": {"lifecycle_state": "ACTIVE", "updated_at_utc": now}},
                        session=session,
                    )
                    self._advance_corpus_revision(session)
        except (DuplicateKeyError, OperationFailure) as exc:
            if isinstance(exc, DuplicateKeyError) or getattr(exc, "code", None) == 112:
                raise RuntimeError("concurrent document revision activation conflict; retry ingestion") from exc
            raise
        return self.revisions.find_one({"document_revision_id": revision_id}, {"_id": 0})

    def list_documents(
        self,
        include_inactive: bool = False,
        requesting_user_id: Optional[str] = None,
        requesting_scope: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        query = {} if include_inactive else {"lifecycle_state": "ACTIVE"}
        revisions = list(self.revisions.find(query, {"_id": 0}).sort("version_number", -1))
        latest: dict[tuple[str, str], dict[str, Any]] = {}
        for revision in revisions:
            key = (revision["document_id"], revision.get("scope", "global"))
            if key in latest:
                continue
            if requesting_user_id is not None or requesting_scope is not None:
                if not is_scope_accessible(
                    revision.get("scope", "global"), revision.get("tenant_id", "default"),
                    requesting_scope=requesting_scope,
                    requesting_user_id=requesting_user_id,
                    tenant_id="default",
                ):
                    continue
            record = dict(revision)
            record["is_active"] = revision.get("lifecycle_state") == "ACTIVE"
            latest[key] = record
        return list(latest.values())

    def soft_delete_document(self, document_id: str, requesting_user_id: Optional[str] = None) -> bool:
        active = list(self.revisions.find({"document_id": document_id, "lifecycle_state": "ACTIVE"}))
        if not active:
            return False
        self._assert_owner(active, requesting_user_id)
        now = datetime.now(timezone.utc).isoformat()
        with self.client.start_session() as session:
            with session.start_transaction():
                for revision in active:
                    result = self.revisions.update_one(
                        {"document_revision_id": revision["document_revision_id"], "lifecycle_state": "ACTIVE"},
                        {"$set": {"lifecycle_state": "SOFT_DELETED", "updated_at_utc": now}},
                        session=session,
                    )
                    if result.matched_count != 1:
                        raise RuntimeError("document changed during soft delete")
                    self.chunks.update_many(
                        {"document_revision_id": revision["document_revision_id"]},
                        {"$set": {"lifecycle_state": "SOFT_DELETED"}},
                        session=session,
                    )
                self._advance_corpus_revision(session)
        return True

    def hard_delete_document(self, document_id: str, requesting_user_id: Optional[str] = None) -> bool:
        revisions = list(self.revisions.find({"document_id": document_id}))
        if not revisions:
            return False
        self._assert_owner(revisions, requesting_user_id)
        with self.client.start_session() as session:
            with session.start_transaction():
                self.chunks.delete_many({"document_id": document_id}, session=session)
                self.revisions.delete_many({"document_id": document_id}, session=session)
                self._advance_corpus_revision(session)
        return True

    def update_metadata(
        self, document_id: str, title: Optional[str], author: Optional[str],
        requesting_user_id: Optional[str] = None,
    ) -> bool:
        active = list(self.revisions.find({"document_id": document_id, "lifecycle_state": "ACTIVE"}))
        if not active:
            return False
        self._assert_owner(active, requesting_user_id)
        now = datetime.now(timezone.utc).isoformat()
        with self.client.start_session() as session:
            with session.start_transaction():
                for previous in active:
                    old_id = previous["document_revision_id"]
                    new_id = str(uuid.uuid4())
                    new_revision = copy.deepcopy(previous)
                    new_revision.pop("_id", None)
                    new_revision.update({
                        "document_revision_id": new_id,
                        "version_number": int(previous.get("version_number", 0)) + 1,
                        "lifecycle_state": "PENDING",
                        "created_at_utc": now,
                        "updated_at_utc": now,
                    })
                    if title:
                        new_revision["title"] = title
                    if author:
                        new_revision["author"] = author
                    self.revisions.insert_one(new_revision, session=session)
                    old_chunks = list(self.chunks.find({"document_revision_id": old_id}, {"_id": 0}, session=session))
                    if not old_chunks:
                        raise RuntimeError("active document revision has no chunks")
                    copies = []
                    for old_chunk in old_chunks:
                        new_chunk = copy.deepcopy(old_chunk)
                        new_chunk["chunk_id"] = f"{old_chunk['chunk_id']}@{new_id}"
                        new_chunk["metadata"]["chunk_id"] = new_chunk["chunk_id"]
                        new_chunk["metadata"]["title"] = new_revision.get("title")
                        new_chunk["metadata"]["author"] = new_revision.get("author")
                        new_chunk["document_revision_id"] = new_id
                        new_chunk["corpus_generation_id"] = new_id
                        new_chunk["lifecycle_state"] = "PENDING"
                        copies.append(new_chunk)
                    self.chunks.insert_many(copies, ordered=True, session=session)
                    self.chunks.update_many({"document_revision_id": old_id}, {"$set": {"lifecycle_state": "SUPERSEDED"}}, session=session)
                    self.revisions.update_one({"document_revision_id": old_id, "lifecycle_state": "ACTIVE"}, {"$set": {"lifecycle_state": "SUPERSEDED", "updated_at_utc": now}}, session=session)
                    self.chunks.update_many({"document_revision_id": new_id}, {"$set": {"lifecycle_state": "ACTIVE"}}, session=session)
                    self.revisions.update_one({"document_revision_id": new_id}, {"$set": {"lifecycle_state": "ACTIVE"}}, session=session)
                self._advance_corpus_revision(session)
        return True

    def reconcile(self, requesting_user_id: Optional[str] = None) -> dict[str, Any]:
        revisions = list(self.revisions.find({}, {"_id": 0}))
        chunks = list(self.chunks.find({}, {"_id": 0, "document_id": 1, "document_revision_id": 1, "scope": 1, "tenant_id": 1}))
        if requesting_user_id is not None:
            revisions = [row for row in revisions if is_scope_accessible(row.get("scope"), row.get("tenant_id"), requesting_user_id=requesting_user_id)]
            visible_ids = {row["document_revision_id"] for row in revisions}
            chunks = [row for row in chunks if row.get("document_revision_id") in visible_ids or (not row.get("document_revision_id") and row.get("scope") == "global")]
        revision_ids = {row["document_revision_id"] for row in revisions}
        chunk_revision_ids = {row.get("document_revision_id") for row in chunks}
        orphan_revision_ids = sorted(str(value) for value in chunk_revision_ids - revision_ids if value)
        active_without_chunks = sorted(
            row["document_revision_id"] for row in revisions
            if row.get("lifecycle_state") == "ACTIVE" and row["document_revision_id"] not in chunk_revision_ids
        )
        return {
            "status": "CLEAN" if not orphan_revision_ids and not active_without_chunks else "ANOMALIES_DETECTED",
            "document_revision_count": len(revisions),
            "chunk_count": len(chunks),
            "orphan_document_revision_ids": orphan_revision_ids,
            "active_revisions_without_chunks": active_without_chunks,
        }

    @staticmethod
    def _assert_owner(revisions: list[dict[str, Any]], requesting_user_id: Optional[str]) -> None:
        if requesting_user_id is None:
            return
        for revision in revisions:
            scope = revision.get("scope", "global")
            owner = revision.get("owner_user_id") or (scope[5:] if scope.startswith("user:") else None)
            if owner != requesting_user_id:
                raise PermissionError("document is not owned by the verified user")

    @staticmethod
    def _revision_document(document, revision_id, version, chunk_count, owner, now, state):
        metadata = document.metadata.model_dump()
        return {
            "document_revision_id": revision_id,
            "document_id": document.document_id,
            "version_number": version,
            "lifecycle_state": state,
            "title": metadata.get("title"),
            "source": metadata.get("source"),
            "document_type": metadata.get("document_type"),
            "author": metadata.get("author"),
            "publication_date": metadata.get("publication_date"),
            "effective_date": metadata.get("effective_date"),
            "source_trust_tier": metadata.get("source_trust_tier"),
            "custom_metadata": metadata.get("custom_metadata", {}),
            "chunk_count": chunk_count,
            "scope": metadata.get("scope", "global"),
            "owner_user_id": owner,
            "tenant_id": metadata.get("tenant_id", "default"),
            "created_at_utc": now,
            "updated_at_utc": now,
        }

    def _advance_corpus_revision(self, session) -> None:
        state = self.state.find_one_and_update(
            {"_id": "active_corpus"},
            {"$inc": {"revision": 1}},
            upsert=True,
            return_document=True,
            session=session,
        )
        revision = int((state or {}).get("revision", 1))
        generations = self.database["rag_corpus_generations"]
        previous = generations.find_one({"active_key": "active", "is_active": True}, session=session)
        if previous:
            generations.update_one(
                {"generation_id": previous["generation_id"], "is_active": True},
                {"$set": {"is_active": False, "superseded_at_utc": datetime.now(timezone.utc).isoformat()}},
                session=session,
            )
        generations.insert_one({
            "generation_id": str(uuid.uuid4()),
            "active_key": "active",
            "revision": revision,
            "is_active": True,
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
        }, session=session)
