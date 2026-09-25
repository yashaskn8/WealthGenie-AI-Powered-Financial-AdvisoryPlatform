"""Run the explicit Phase-3 Mongo indexes/state migration before deployment."""

from __future__ import annotations

import os
import sys

from pymongo import MongoClient

from model.migrations.phase3_state import migrate_phase3_state


def main() -> int:
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not uri:
        print("MONGODB_URI is required; Phase-3 migration was not run.", file=sys.stderr)
        return 2

    # Keep this aligned with store_factory, which intentionally uses the same
    # shared production database for the registry and vector store.
    database_name = "wealthgenie"

    client = MongoClient(uri, serverSelectionTimeoutMS=10000)
    try:
        client.admin.command("ping")
        migrate_phase3_state(client[database_name])
    except Exception as exc:
        print(
            f"Phase-3 shared-state migration failed ({type(exc).__name__}); "
            "inspect secured migration logs for details.",
            file=sys.stderr,
        )
        return 1
    finally:
        client.close()

    print(f"Phase-3 shared-state migration verified for database {database_name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
