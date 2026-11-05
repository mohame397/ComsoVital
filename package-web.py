"""Package the standalone static site with index.html at the ZIP root.

Includes exactly one generated archive: the complete source ZIP, so the source
download link works after independent hosting. Complete must be generated first
and contain no ZIPs. Outputs go to dist/ and /workspace/shared/.
"""
from pathlib import Path
import os
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / 'dist'
SHARED_DIR = Path('/workspace/shared')
ARCHIVE_NAME = 'CosmoVital-Web.zip'
SOURCE_ARCHIVE_NAME = 'CosmoVital-Complete.zip'
EXCLUDED_PARTS = {'__pycache__', '.git', 'node_modules', '.openai'}


def include_file(file: Path) -> bool:
    if not file.is_file() or EXCLUDED_PARTS.intersection(file.relative_to(STATIC_DIR).parts):
        return False
    if file.suffix.lower() == '.zip':
        # Only the complete-source download at the static root may be nested.
        return file == STATIC_DIR / SOURCE_ARCHIVE_NAME
    return file.suffix.lower() != '.pyc' 


def build_archive() -> tuple[Path, Path]:
    if not (STATIC_DIR / 'index.html').is_file():
        raise FileNotFoundError('dist/index.html is required for standalone packaging.')
    source_archive = STATIC_DIR / SOURCE_ARCHIVE_NAME
    if not source_archive.is_file():
        raise FileNotFoundError('Generate CosmoVital-Complete.zip with package-source.py first.')
    with zipfile.ZipFile(source_archive) as source:
        if source.testzip() is not None:
            raise RuntimeError('Complete source ZIP failed its integrity check; regenerate it first.')
        if any(name.lower().endswith('.zip') for name in source.namelist()):
            raise RuntimeError('Complete source ZIP contains nested archives; regenerate it with package-source.py.')
    SHARED_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix='cosmovital-web-', suffix='.tmp',
                                     dir=SHARED_DIR, delete=False) as handle:
        staging = Path(handle.name)
    try:
        with zipfile.ZipFile(staging, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for file in sorted(STATIC_DIR.rglob('*')):
                if include_file(file):
                    output.write(file, file.relative_to(STATIC_DIR).as_posix())
        with zipfile.ZipFile(staging) as check:
            names = check.namelist()
            if check.testzip() is not None:
                raise RuntimeError('Standalone ZIP integrity check failed.')
            if 'index.html' not in names:
                raise RuntimeError('Standalone ZIP is missing root index.html.')
            nested_archives = [name for name in names if name.lower().endswith('.zip')]
            if nested_archives != [SOURCE_ARCHIVE_NAME]:
                raise RuntimeError('Standalone ZIP must contain exactly the root complete-source ZIP.')
        shared_archive = SHARED_DIR / ARCHIVE_NAME
        archive = STATIC_DIR / ARCHIVE_NAME
        os.replace(staging, shared_archive)
        shutil.copy2(shared_archive, archive)
        return archive, shared_archive
    finally:
        staging.unlink(missing_ok=True)


if __name__ == '__main__':
    local, shared = build_archive()
    with zipfile.ZipFile(local) as result:
        count = len(result.namelist())
    print(f'Standalone ZIP: {local} ({local.stat().st_size} bytes, {count} files)')
    print(f'Shared copy: {shared}')
