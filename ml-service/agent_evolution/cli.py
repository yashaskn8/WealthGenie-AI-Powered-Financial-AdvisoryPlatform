"""Manual-only entry point for a future live GEPA experiment."""

import argparse

from .gepa_optimizer import GEPA_VERSION


def main() -> int:
    parser = argparse.ArgumentParser(description='Run a governed offline GEPA experiment.')
    parser.add_argument('--version', action='store_true')
    args = parser.parse_args()
    if args.version:
        print(GEPA_VERSION)
        return 0
    raise SystemExit('A host-supplied sanitized student/dataset is required; no implicit production data is permitted.')


if __name__ == '__main__':
    raise SystemExit(main())
