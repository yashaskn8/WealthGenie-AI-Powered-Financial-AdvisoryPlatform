"""Manual-only entry point for a bounded GEPA proposal experiment."""

import argparse
import json
import os
from pathlib import Path

from .gepa_optimizer import GEPA_VERSION
from .runner import create_proposal_provider
from .schemas import validate_gepa_input, validate_proposal_output


def _safe_path(value: str, *, must_exist: bool) -> Path:
    path = Path(value).resolve()
    lowered = str(path).lower()
    if any(token in lowered for token in ('.env', 'production', 'mongo', 'credential', 'secret')):
        raise ValueError('GEPA CLI path is not an approved sanitized workspace path')
    if must_exist and not path.is_file():
        raise FileNotFoundError(str(path))
    if not must_exist and path.name in {'.', '..'}:
        raise ValueError('GEPA output path is invalid')
    return path


def _run(args: argparse.Namespace) -> int:
    input_path = _safe_path(args.input, must_exist=True)
    output_path = _safe_path(args.output, must_exist=False)
    if not output_path.parent.is_dir():
        raise FileNotFoundError(str(output_path.parent))
    if output_path.exists():
        raise FileExistsError(str(output_path))
    if output_path == input_path:
        raise ValueError('GEPA input and output paths must be different')
    if input_path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('GEPA input exceeds the bridge size limit')
    with input_path.open('r', encoding='utf-8') as handle:
        document = json.load(handle)
    validate_gepa_input(document)
    if document['optimizer']['provider'] != args.provider:
        raise ValueError('GEPA provider does not match the bridge input')
    proposals = create_proposal_provider(args.provider).propose(document)
    validate_proposal_output(proposals, document)
    payload = json.dumps(proposals, ensure_ascii=False, separators=(',', ':'))
    if len(payload.encode('utf-8')) > 2 * 1024 * 1024:
        raise ValueError('GEPA output exceeds the bridge size limit')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(output_path, flags)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(payload)
    except Exception:
        os.close(descriptor)
        raise
    print(json.dumps({'provider': args.provider, 'proposalCount': len(proposals)}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Run a governed offline GEPA experiment.')
    parser.add_argument('--version', action='store_true')
    parser.add_argument('command', nargs='?', choices=['run'])
    parser.add_argument('--input')
    parser.add_argument('--output')
    parser.add_argument('--provider', choices=['fixture', 'dspy'], default='fixture')
    args = parser.parse_args()
    if args.version:
        print(GEPA_VERSION)
        return 0
    if args.command == 'run' and args.input and args.output:
        try:
            return _run(args)
        except Exception as error:
            print(f'{type(error).__name__}: {error}', file=__import__('sys').stderr)
            return 1
    raise SystemExit('A host-supplied sanitized input/output is required; no implicit production data is permitted.')


if __name__ == '__main__':
    raise SystemExit(main())
