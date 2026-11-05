"""Package complete source without hosting identity, browser state, or nested ZIPs.

Run from any directory: python /path/to/project/scripts/package-source.py
Outputs are copied to dist/ and /workspace/shared/ after ZIP integrity checking.
"""
from pathlib import Path
import json
import os
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SHARED_DIR = Path('/workspace/shared')
ARCHIVE_NAME = 'CosmoVital-Complete.zip'
GENERATED_ARCHIVES = {'CosmoVital-Complete.zip', 'CosmoVital-Web.zip'}
EXCLUDED_PARTS = {'__pycache__', '.git', 'node_modules', '.pytest_cache'}


def include_file(file: Path) -> bool:
    """Never bundle generated deliverables or other archives inside the source."""
    return (
        file.is_file()
        and file.name not in GENERATED_ARCHIVES
        and file.suffix.lower() not in {'.zip', '.pyc'}
        and not EXCLUDED_PARTS.intersection(file.relative_to(ROOT).parts)
    )


def build_archive() -> tuple[Path, Path]:
    archive = ROOT / 'dist' / ARCHIVE_NAME
    archive.parent.mkdir(parents=True, exist_ok=True)
    SHARED_DIR.mkdir(parents=True, exist_ok=True)
    # Stage outside the checkout so a recursive source scan cannot include itself.
    with tempfile.NamedTemporaryFile(prefix='cosmovital-source-', suffix='.tmp',
                                     dir=SHARED_DIR, delete=False) as handle:
        staging = Path(handle.name)
    try:
        with zipfile.ZipFile(staging, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for folder in ['dist', 'docs', 'tests', 'scripts', 'original', 'supabase']:
                for file in sorted((ROOT / folder).rglob('*')):
                    if include_file(file):
                        output.write(file, 'CosmoVital/' + file.relative_to(ROOT).as_posix())
            for name in ['package.json', 'package-lock.json', 'vercel.json', '.env.example', 'README.md', 'LICENSE']:
                output.write(ROOT / name, 'CosmoVital/' + name)
            for file in sorted((ROOT / 'qa').glob('*')):
                if include_file(file) and file.suffix in {'.mjs', '.json'}:
                    output.write(file, 'CosmoVital/qa/' + file.name)
            output.writestr(
                'CosmoVital/.openai/hosting.example.json',
                json.dumps({'static': {'directory': 'dist'}}, indent=2) + '\n',
            )
        with zipfile.ZipFile(staging) as check:
            if check.testzip() is not None:
                raise RuntimeError('Source ZIP integrity check failed.')
            if any(name.lower().endswith('.zip') for name in check.namelist()):
                raise RuntimeError('Source ZIP unexpectedly contains a nested archive.')
        shared_archive = SHARED_DIR / ARCHIVE_NAME
        # Publish the shared result only after the archive has passed checks.
        os.replace(staging, shared_archive)
        shutil.copy2(shared_archive, archive)
        return archive, shared_archive
    finally:
        staging.unlink(missing_ok=True)


if __name__ == '__main__':
    local, shared = build_archive()
    with zipfile.ZipFile(local) as result:
        count = len(result.namelist())
    print(f'Source ZIP: {local} ({local.stat().st_size} bytes, {count} files)')
    print(f'Shared copy: {shared}')
