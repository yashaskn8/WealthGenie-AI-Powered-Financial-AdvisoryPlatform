"""
rollback.py — CLI to roll back to a prior registered model version.

Verifies artifact hash integrity before activating — refuses to activate
a tampered or missing checkpoint (same tamper-evidence pattern as Phase 2).

Usage:
  python -m scripts.rollback --to-version <version_id>
"""

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from store_factory import get_model_registry


def main():
    parser = argparse.ArgumentParser(description="Roll back to a prior registered model version.")
    parser.add_argument("--to-version", type=str, required=True,
                        help="Version ID to roll back to")
    parser.add_argument("--db-path", type=str, default=None)
    args = parser.parse_args()

    db_path = Path(args.db_path) if args.db_path else None
    registry = get_model_registry(db_path=db_path)
    try:
        version = registry.rollback_to_version(args.to_version)
        print(f"[OK] Rolled back to version {args.to_version}")
        print(f"  Architecture: {version['model_architecture']}")
        print(f"  Bundle:       {version['bundle_id']}")
        print(f"  Active:       {version['is_active']}")
    except FileNotFoundError as e:
        print(f"ROLLBACK BLOCKED: {e}")
        sys.exit(1)
    except RuntimeError as e:
        print(f"ROLLBACK BLOCKED: {e}")
        sys.exit(1)
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    finally:
        registry.close()


if __name__ == "__main__":
    main()
