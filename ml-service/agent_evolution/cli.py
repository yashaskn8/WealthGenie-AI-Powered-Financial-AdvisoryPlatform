"""Manual-only entry point for a bounded GEPA proposal experiment."""

import argparse
import json
import os
import stat
import tempfile
from pathlib import Path

from .gepa_optimizer import GEPA_VERSION
from .runner import create_proposal_provider
from .schemas import validate_gepa_input, validate_proposal_output


def _safe_path(value: str, *, must_exist: bool) -> Path:
    temporary_root = Path(os.path.abspath(tempfile.gettempdir()))
    path = Path(os.path.abspath(value))
    try:
        relative = path.relative_to(temporary_root)
    except ValueError as error:
        raise ValueError('GEPA CLI path is not an approved sanitized workspace path') from error

    expected_name = 'input.json' if must_exist else 'output.json'
    if (len(relative.parts) != 1
            or not temporary_root.name.startswith('wealthgenie-gepa-')
            or relative.parts[0] != expected_name):
        raise ValueError('GEPA CLI path is not an approved sanitized workspace path')

    root_stat = os.lstat(temporary_root)
    if (not stat.S_ISDIR(root_stat.st_mode)
            or stat.S_ISLNK(root_stat.st_mode)
            or getattr(os.path, 'isjunction', lambda _path: False)(temporary_root)):
        raise ValueError('GEPA invocation directory is not a regular private directory')
    if os.path.normcase(os.path.realpath(temporary_root)) != os.path.normcase(str(temporary_root)):
        raise ValueError('GEPA invocation directory identity changed')

    try:
        path_stat = os.lstat(path)
    except FileNotFoundError:
        if must_exist:
            raise
        return path

    if (stat.S_ISLNK(path_stat.st_mode)
            or getattr(os.path, 'isjunction', lambda _path: False)(path)
            or (must_exist and not stat.S_ISREG(path_stat.st_mode))):
        raise ValueError('GEPA CLI file is not a regular non-link file')
    if not must_exist:
        raise FileExistsError(str(path))
    if os.path.normcase(os.path.realpath(path)) != os.path.normcase(str(path)):
        raise ValueError('GEPA CLI file resolved outside its private directory')
    return path


def _open_input(path: Path, *, max_bytes: int = 2 * 1024 * 1024):
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_size > max_bytes:
        raise ValueError('GEPA input is not a bounded regular file')
    no_follow = getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, os.O_RDONLY | no_follow)
    opened = os.fstat(descriptor)
    if (not stat.S_ISREG(opened.st_mode)
            or opened.st_size > max_bytes
            or (before.st_ino and opened.st_ino and before.st_ino != opened.st_ino)
            or before.st_dev != opened.st_dev):
        os.close(descriptor)
        raise ValueError('GEPA input identity changed before read')
    return descriptor, before


def _run(args: argparse.Namespace) -> int:
    input_path = _safe_path(args.input, must_exist=True)
    output_path = _safe_path(args.output, must_exist=False)
    if not output_path.parent.is_dir():
        raise FileNotFoundError(str(output_path.parent))
    if output_path.exists():
        raise FileExistsError(str(output_path))
    if output_path == input_path:
        raise ValueError('GEPA input and output paths must be different')
    descriptor, input_stat = _open_input(input_path)
    try:
        with os.fdopen(descriptor, 'r', encoding='utf-8') as handle:
            document = json.load(handle)
    finally:
        after = os.lstat(input_path)
        if (not stat.S_ISREG(after.st_mode)
                or stat.S_ISLNK(after.st_mode)
                or (input_stat.st_ino and after.st_ino and input_stat.st_ino != after.st_ino)
                or input_stat.st_dev != after.st_dev):
            raise ValueError('GEPA input identity changed while read')
    validate_gepa_input(document)
    if document['optimizer']['provider'] != args.provider:
        raise ValueError('GEPA provider does not match the bridge input')
    proposals = create_proposal_provider(args.provider).propose(document)
    validate_proposal_output(proposals, document)
    payload = json.dumps(proposals, ensure_ascii=False, separators=(',', ':'))
    if len(payload.encode('utf-8')) > 2 * 1024 * 1024:
        raise ValueError('GEPA output exceeds the bridge size limit')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
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
