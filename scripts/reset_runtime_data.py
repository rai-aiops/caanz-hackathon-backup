from __future__ import annotations

import shutil
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
STORE_DATA_DIR = DATA_DIR / "store"
RUNTIME_DATA_DIR = DATA_DIR / "runtime"


def _copy_store_item_to_runtime(store_path: Path, runtime_path: Path) -> list[Path]:
    if store_path.is_dir():
        shutil.copytree(store_path, runtime_path)
        return sorted(path for path in runtime_path.rglob("*") if path.is_file())

    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(store_path, runtime_path)
    return [runtime_path]


def restore_runtime_data() -> list[Path]:
    """Rebuild data/runtime by copying all fixtures from data/store."""
    if not STORE_DATA_DIR.exists():
        raise FileNotFoundError(f"Store data directory not found: {STORE_DATA_DIR}")

    if RUNTIME_DATA_DIR.exists():
        shutil.rmtree(RUNTIME_DATA_DIR)

    RUNTIME_DATA_DIR.mkdir(parents=True, exist_ok=True)

    restored_paths: list[Path] = []
    for store_path in sorted(STORE_DATA_DIR.iterdir()):
        runtime_path = RUNTIME_DATA_DIR / store_path.name
        restored_paths.extend(_copy_store_item_to_runtime(store_path, runtime_path))

    return restored_paths


def main() -> None:
    restored_paths = restore_runtime_data()
    print(f"Restored {len(restored_paths)} runtime data file(s) into {RUNTIME_DATA_DIR}")


if __name__ == "__main__":
    main()
