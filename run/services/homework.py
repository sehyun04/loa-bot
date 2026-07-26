import json
import time
from dataclasses import dataclass
from functools import lru_cache

from run.core import config, db
from run.utils import timez


@dataclass(frozen=True)
class Content:
    id: str
    name: str
    cycle: str
    gates: int
    min_level: int
    order: int


@dataclass
class TaskState:
    task_id: int
    content: Content
    cleared_gates: int

    @property
    def done(self) -> bool:
        return self.cleared_gates >= self.content.gates

    @property
    def label(self) -> str:
        if self.content.gates > 1:
            return f"{self.content.name} {self.cleared_gates}/{self.content.gates}"
        return self.content.name


@lru_cache(maxsize=1)
def catalog() -> dict[str, Content]:
    raw = json.loads((config.RESOURCE_DIR / "homework.json").read_text(encoding="utf-8"))
    items = [
        Content(c["id"], c["name"], c["cycle"], c["gates"], c["min_level"], c["order"])
        for c in raw["contents"]
    ]
    return {c.id: c for c in sorted(items, key=lambda c: c.order)}


def suggested_for(item_level: float | None) -> list[Content]:
    """해당 레벨로 갈 수 있는 컨텐츠. 캐릭터 등록 시 기본 선택값으로 쓴다."""
    level = item_level or 0
    return [c for c in catalog().values() if level >= c.min_level]


async def register_character(
    user_id: str, name: str, server: str | None, class_name: str | None, item_level: float | None
) -> None:
    await db.aexecute(
        "INSERT INTO hw_characters (user_id, character_name, server_name, class_name, item_level) "
        "VALUES (?,?,?,?,?) "
        "ON CONFLICT(user_id, character_name) DO UPDATE SET "
        "  server_name=excluded.server_name, class_name=excluded.class_name, "
        "  item_level=excluded.item_level, enabled=1",
        (user_id, name, server, class_name, item_level),
    )


async def list_characters(user_id: str) -> list[dict]:
    rows = await db.aquery(
        "SELECT character_name, server_name, class_name, item_level FROM hw_characters "
        "WHERE user_id=? AND enabled=1 ORDER BY item_level DESC",
        (user_id,),
    )
    return [dict(r) for r in rows]


async def set_contents(user_id: str, character: str, content_ids: list[str]) -> None:
    known = catalog()
    wanted = [cid for cid in content_ids if cid in known]

    await db.aexecute(
        "DELETE FROM hw_tasks WHERE user_id=? AND character_name=?"
        + (f" AND content_id NOT IN ({','.join('?' * len(wanted))})" if wanted else ""),
        (user_id, character, *wanted),
    )
    for cid in wanted:
        await db.aexecute(
            "INSERT OR IGNORE INTO hw_tasks (user_id, character_name, content_id, gate_total) "
            "VALUES (?,?,?,?)",
            (user_id, character, cid, known[cid].gates),
        )


async def load_tasks(user_id: str, character: str) -> list[TaskState]:
    rows = await db.aquery(
        "SELECT t.id, t.content_id, p.period_key, p.cleared_gates "
        "FROM hw_tasks t LEFT JOIN hw_progress p ON p.task_id = t.id "
        "WHERE t.user_id=? AND t.character_name=?",
        (user_id, character),
    )
    known = catalog()
    states = []
    for row in rows:
        content = known.get(row["content_id"])
        if content is None:
            continue
        current = timez.period_key(content.cycle)
        # 저장된 기록이 지난 주기의 것이면 없는 셈 친다
        cleared = row["cleared_gates"] if row["period_key"] == current else 0
        states.append(TaskState(row["id"], content, cleared or 0))
    return sorted(states, key=lambda s: s.content.order)


async def toggle(user_id: str, task_id: int) -> TaskState | None:
    row = await db.aquery_one(
        "SELECT t.id, t.user_id, t.character_name, t.content_id, p.period_key, p.cleared_gates "
        "FROM hw_tasks t LEFT JOIN hw_progress p ON p.task_id=t.id WHERE t.id=?",
        (task_id,),
    )
    # 남의 숙제를 누르지 못하게 소유자를 반드시 확인한다
    if row is None or row["user_id"] != user_id:
        return None

    content = catalog().get(row["content_id"])
    if content is None:
        return None

    current = timez.period_key(content.cycle)
    cleared = row["cleared_gates"] if row["period_key"] == current else 0
    cleared = (cleared or 0) + 1
    if cleared > content.gates:
        cleared = 0

    await db.aexecute(
        "INSERT INTO hw_progress (task_id, period_key, cleared_gates, updated_at) VALUES (?,?,?,?) "
        "ON CONFLICT(task_id) DO UPDATE SET "
        "  period_key=excluded.period_key, cleared_gates=excluded.cleared_gates, "
        "  updated_at=excluded.updated_at",
        (task_id, current, cleared, int(time.time())),
    )
    return TaskState(task_id, content, cleared)


async def purge_stale() -> int:
    """지난 주기 기록 정리. 정확성은 읽기 시점 판정이 보장하므로 용량 관리용이다."""
    return await db.aexecute(
        "DELETE FROM hw_progress WHERE period_key NOT IN (?, ?)",
        (timez.daily_key(), timez.weekly_key()),
    )
