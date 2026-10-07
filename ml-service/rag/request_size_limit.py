"""Bound RAG request bodies before FastAPI parses JSON or validates models."""

import json

from fastapi import HTTPException


RAG_INDEX_MAX_BODY_BYTES = 1_000_000
RAG_QUERY_MAX_BODY_BYTES = 128_000


class RAGRequestBodyLimitMiddleware:
    """Stream and cap RAG JSON bodies before route validation allocates them."""

    def __init__(self, app):
        self.app = app
        self.body_limits = {
            ("POST", "/rag/index"): RAG_INDEX_MAX_BODY_BYTES,
            ("POST", "/rag/query"): RAG_QUERY_MAX_BODY_BYTES,
        }

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        route = (scope.get("method", "").upper(), scope.get("path", ""))
        body_limit = self.body_limits.get(route)
        if body_limit is None:
            await self.app(scope, receive, send)
            return

        content_length = next(
            (value for name, value in scope.get("headers", []) if name.lower() == b"content-length"),
            None,
        )
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except (TypeError, ValueError):
                declared_length = None
            if declared_length is not None and declared_length > body_limit:
                await self._reject(scope, send, route[1], "RAG request body exceeds the size limit.")
                return

        body = bytearray()
        while True:
            message = await receive()
            if message.get("type") == "http.disconnect":
                return
            if message.get("type") != "http.request":
                continue
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > body_limit:
                await self._reject(scope, send, route[1], "RAG request body exceeds the size limit.")
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        if route[1] == "/rag/index" and self._index_content_exceeds_character_limit(body):
            await self._reject(scope, send, route[1], "RAG document content exceeds the character limit.")
            return

        body_bytes = bytes(body)
        replayed = False

        async def replay_receive():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body_bytes, "more_body": False}
            return await receive()

        await self._forward_with_validation_quota(scope, route[1], replay_receive, send)

    async def _forward_with_validation_quota(self, scope, path, receive, send):
        """Charge authenticated schema/JSON failures so validation cannot bypass quotas."""
        replaced_response = False

        async def count_validation_failure(message):
            nonlocal replaced_response
            if message.get("type") != "http.response.start" or message.get("status") != 422:
                await send(message)
                return

            try:
                await self._charge_prevalidation(scope, path)
            except HTTPException as exc:
                if exc.status_code != 429:
                    await send(message)
                    return
                replaced_response = True
                await self._send_json_response(
                    scope, send, 429, "Rate limit exceeded. Try again later.",
                )
                return

            await send(message)

        async def quota_send(message):
            if replaced_response and message.get("type") == "http.response.body":
                return
            await count_validation_failure(message)

        await self.app(scope, receive, quota_send)

    @staticmethod
    def _index_content_exceeds_character_limit(body: bytearray) -> bool:
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
            return False
        if not isinstance(payload, dict) or not isinstance(payload.get("content"), str):
            return False
        from rag.router import MAX_INGEST_TEXT_CHARS

        return len(payload["content"]) > MAX_INGEST_TEXT_CHARS

    @staticmethod
    async def _reject(scope, send, path, detail):
        """Count pre-validation abuse by client IP, then return a safe bounded response."""
        status_code = 413
        try:
            await RAGRequestBodyLimitMiddleware._charge_prevalidation(scope, path)
        except HTTPException as exc:
            status_code = exc.status_code
            detail = "Rate limit exceeded. Try again later."

        await RAGRequestBodyLimitMiddleware._send_json_response(scope, send, status_code, detail)

    @staticmethod
    async def _charge_prevalidation(scope, path):
        """Use full quotas for authenticated callers and IP-only limits otherwise."""
        headers = {name.lower(): value.decode("latin-1") for name, value in scope.get("headers", [])}
        try:
            from security import verify_api_key

            await verify_api_key(headers.get("x-api-key"))
            authenticated = True
        except HTTPException as auth_error:
            if auth_error.status_code != 401:
                return
            authenticated = False

        client = scope.get("client")
        client_ip = str(client[0]) if client and client[0] else "unknown"
        request_kind = "index" if path == "/rag/index" else "query"
        from rag.router import check_prevalidation_ip_rate_limit, check_rate_limit

        if authenticated:
            principal = headers.get("x-verified-user-id", "").strip() or f"prevalidation:{client_ip}"
            check_rate_limit(client_ip, principal, request_kind=request_kind)
        else:
            check_prevalidation_ip_rate_limit(client_ip, request_kind=request_kind)

    @staticmethod
    async def _send_json_response(scope, send, status_code, detail):
        response_body = json.dumps({"detail": detail}, separators=(",", ":")).encode("utf-8")
        headers = [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(response_body)).encode("ascii")),
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"x-xss-protection", b"1; mode=block"),
        ]
        if scope.get("http_version") == "1.1":
            headers.append((b"connection", b"close"))
        await send({"type": "http.response.start", "status": status_code, "headers": headers})
        await send({"type": "http.response.body", "body": response_body})
