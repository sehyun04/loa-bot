import asyncio
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from run.core import config

MIGRATIONS_DIR = config.BASE_DIR / "migrations"


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _applied_versions(conn: sqlite3.Connection) -> set[int]:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "  version INTEGER PRIMARY KEY,"
        "  applied_at INTEGER NOT NULL"
        ")"
    )
    return {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}


def _migration_files() -> list[tuple[int, Path]]:
    if not MIGRATIONS_DIR.exists():
        return []
    found = []
    for path in MIGRATIONS_DIR.glob("*.sql"):
        prefix = path.name.split("_", 1)[0]
        if prefix.isdigit():
            found.append((int(prefix), path))
    return sorted(found)


def migrate() -> list[int]:
    """미적용 마이그레이션을 순서대로 실행하고 적용된 버전을 반환한다.

    2인 협업이라 스키마 변경이 양쪽에서 나온다. 어떤 변경이 적용됐는지
    DB가 스스로 알고 있어야 서로의 브랜치를 오갈 때 어긋나지 않는다.
    """
    applied_now = []
    with connect() as conn:
        done = _applied_versions(conn)
        for version, path in _migration_files():
            if version in done:
                continue
            conn.executescript(path.read_text(encoding="utf-8"))
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%s','now'))",
                (version,),
            )
            applied_now.append(version)
    return applied_now


def query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with connect() as conn:
        return list(conn.execute(sql, params))


def query_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: tuple = ()) -> int:
    with connect() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid or cur.rowcount


# sqlite3는 동기 라이브러리라 그대로 호출하면 이벤트 루프가 멈춘다
async def aquery(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return await asyncio.to_thread(query, sql, params)


async def aquery_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    return await asyncio.to_thread(query_one, sql, params)


async def aexecute(sql: str, params: tuple = ()) -> int:
    return await asyncio.to_thread(execute, sql, params)


async def amigrate() -> list[int]:
    return await asyncio.to_thread(migrate)


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None
