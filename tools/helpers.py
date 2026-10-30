"""Small persistence and search helpers shared by the CAANZ fixture tools."""

import errno
import json
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from time import sleep
from typing import Any

if os.name == "nt":
    import msvcrt
else:
    import fcntl

RUNTIME_DIR = Path(__file__).resolve().parents[1] / "data" / "runtime"
STORE_LOCK = RLock()
DEFAULT_SEARCH_LIMIT = 10
MAX_SEARCH_LIMIT = 50
LOCK_RETRY_SECONDS = 0.1


class RecordNotFound(ValueError):
    """A requested fixture record does not exist."""


def read_store(filename: str) -> dict[str, Any]:
    """Read one runtime JSON store without restoring fixtures."""
    return json.loads((RUNTIME_DIR / filename).read_text(encoding="utf-8"))


def write_store(filename: str, data: dict[str, Any]) -> None:
    """Replace one runtime JSON file atomically after serialization succeeds."""
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    temporary_path = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=RUNTIME_DIR,
            prefix=".caanz-",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary_path = Path(output.name)
            output.write(payload)
            output.flush()
        temporary_path.replace(RUNTIME_DIR / filename)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


@contextmanager
def fixture_lock() -> Iterator[None]:
    """Serialize fixture operations across threads and local worker processes."""
    with STORE_LOCK, (RUNTIME_DIR / ".caanz.lock").open("a+b") as lock:
        if os.name == "nt":
            # Lock byte zero, even in an empty file, on every Windows worker.
            lock.seek(0)
            while True:
                try:
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as error:
                    if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                        raise
                    sleep(LOCK_RETRY_SECONDS)
        else:
            fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def search_records(
    records: list[dict[str, Any]],
    query: str,
    fields: tuple[str, ...],
    limit: int = DEFAULT_SEARCH_LIMIT,
) -> list[dict[str, Any]]:
    """Rank records by distinct matching words; expose match evidence, not confidence."""
    if not 1 <= limit <= MAX_SEARCH_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_SEARCH_LIMIT}.")
    terms = set(re.findall(r"\w+", query.casefold()))
    matches = []
    for record in records:
        matched_fields = {}
        for field in fields:
            text = json.dumps(record.get(field, ""), ensure_ascii=False).casefold()
            found = sorted(terms & set(re.findall(r"\w+", text)))
            if found:
                matched_fields[field] = found
        matched_terms = sorted(
            {term for found in matched_fields.values() for term in found}
        )
        if matched_terms or not terms:
            matches.append(
                {
                    "record": record,
                    "matched_terms": matched_terms,
                    "matched_fields": matched_fields,
                    "score": len(matched_terms),
                }
            )
    matches.sort(
        key=lambda match: (-match["score"], str(match["record"].get("id", "")))
    )
    return matches[:limit]
