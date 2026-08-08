import hashlib
import json
import time
from dataclasses import dataclass
from functools import lru_cache

from run.core import config, db
from run.utils import timez


@dataclass(frozen=True)
class Level:
    name: str
    min_level: int


@dataclass(frozen=True)
class Content:
    id: str
    name: str
    cycle: str
    min_level: int
    max_level: int | None
    order: int
    # 쉬운 난이도부터. 비어 있으면 난이도 없이 완료/미완료만 본다.
    levels: tuple[Level, ...] = ()

    @property
    def steps(self) -> int:
        """한 바퀴 도는 데 필요한 클릭 수. 난이도가 없으면 완료 한 단계뿐이다."""
        return len(self.levels) or 1

    def levels_for(self, item_level: float | None) -> list[tuple[int, Level]]:
        """그 레벨로 갈 수 있는 난이도만. 1750짜리한테 벨가 하드를 띄우지 않는다.

        순번은 저장값(hw_progress.cleared_gates)이라 걸러내도 원래 자리를 지킨다.
        걸러낸 뒤 다시 매기면 이미 찍어둔 난이도가 엉뚱한 것으로 바뀐다.
        """
        level = item_level or 0
        return [(i, lv) for i, lv in enumerate(self.levels, 1) if level >= lv.min_level]


@dataclass
class TaskState:
    task_id: int
    content: Content
    # 0이면 미클리어, 1..N이면 content.levels[N-1]을 깼다는 뜻.
    # 관문 수를 세던 시절의 컬럼(hw_progress.cleared_gates)을 그대로 쓴다.
    cleared: int

    @property
    def done(self) -> bool:
        return self.cleared >= 1

    @property
    def level_name(self) -> str | None:
        """깬 난이도. 난이도가 없는 컨텐츠거나 아직 안 깼으면 None."""
        if not self.done or not self.content.levels:
            return None
        return self.content.levels[self.cleared - 1].name

    @property
    def label(self) -> str:
        return self.content.name


@lru_cache(maxsize=1)
def _raw_catalog() -> dict:
    return json.loads((config.RESOURCE_DIR / "homework.json").read_text(encoding="utf-8"))


def _parse_levels(raw: list, content_min: int) -> tuple[Level, ...]:
    """난이도 항목은 두 가지로 적을 수 있다.

    입장 레벨이 따로 있으면 {"name": "하드", "min_level": 1770}, 컨텐츠 입장
    레벨과 같으면 그냥 "하드". 옛 레이드는 난이도별 입장 레벨을 몰라서 후자로 뒀다.
    """
    levels = []
    for item in raw or ():
        if isinstance(item, str):
            levels.append(Level(item, content_min))
        else:
            levels.append(Level(item["name"], item.get("min_level", content_min)))
    return tuple(levels)


@lru_cache(maxsize=1)
def catalog() -> dict[str, Content]:
    items = [
        Content(
            c["id"],
            c["name"],
            c["cycle"],
            c["min_level"],
            c.get("max_level"),
            c["order"],
            _parse_levels(c.get("levels"), c["min_level"]),
        )
        for c in _raw_catalog()["contents"]
    ]
    return {c.id: c for c in sorted(items, key=lambda c: c.order)}


def catalog_version() -> str:
    """컨텐츠 목록이 바뀌면 자동으로 달라지는 값. 등록된 숙제 목록을 언제 맞춰야
    하는지 판단하는 기준이 된다.

    처음엔 _updated 날짜를 썼는데, 같은 날 두 번 고치면 값이 그대로라 갱신이
    안 걸린다. 목록 자체에서 뽑으면 올리는 걸 잊을 수가 없다.
    """
    payload = json.dumps(_raw_catalog()["contents"], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def suggested_for(item_level: float | None) -> list[Content]:
    """해당 레벨로 갈 수 있는 컨텐츠. 캐릭터 등록 시 기본 선택값으로 쓴다.

    min_level만 보면 졸업한 옛 레이드가 계속 쌓인다. 1720 캐릭터한테 에키드나까지
    띄우지 않으려면 max_level로 위쪽도 잘라야 한다.
    """
    level = item_level or 0
    return [
        c
        for c in catalog().values()
        if level >= c.min_level and (c.max_level is None or level < c.max_level)
    ]


async def register_character(
    user_id: str, name: str, server: str | None, class_name: str | None, item_level: float | None
) -> None:
    await db.aexecute(
        "INSERT INTO hw_characters "
        "  (user_id, character_name, server_name, class_name, item_level, catalog_version) "
        "VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(user_id, character_name) DO UPDATE SET "
        "  server_name=excluded.server_name, class_name=excluded.class_name, "
        "  item_level=excluded.item_level, catalog_version=excluded.catalog_version, enabled=1",
        (user_id, name, server, class_name, item_level, catalog_version()),
    )


async def list_characters(user_id: str) -> list[dict]:
    rows = await db.aquery(
        "SELECT character_name, server_name, class_name, item_level FROM hw_characters "
        "WHERE user_id=? AND enabled=1 ORDER BY item_level DESC",
        (user_id,),
    )
    return [dict(r) for r in rows]


def same_roster(characters: list[dict], character: str) -> list[dict]:
    """character와 같은 원정대(=같은 서버) 캐릭터만 남긴다.

    로아 원정대는 서버 단위라 서버명이 곧 원정대 구분이다. 서버가 비어 있는
    옛 등록분은 어느 원정대인지 알 수 없으니 그냥 남겨둔다.
    """
    server = next(
        (c["server_name"] for c in characters if c["character_name"] == character), None
    )
    if server is None:
        return characters
    return [c for c in characters if c["server_name"] in (server, None)]


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
            "INSERT OR IGNORE INTO hw_tasks (user_id, character_name, content_id) VALUES (?,?,?)",
            (user_id, character, cid),
        )


async def sync_contents(user_id: str, character: str) -> bool:
    """카탈로그가 바뀌었으면 그 캐릭터의 숙제 목록을 새 추천으로 맞춘다.

    열 때마다 맞추면 나중에 컨텐츠를 손으로 고르는 기능이 생겼을 때 그 선택을
    매번 덮어쓴다. 그래서 카탈로그 버전이 달라졌을 때만 건드린다. 살아남는
    컨텐츠는 task 행이 그대로라 이번 주 체크도 유지된다.
    """
    row = await db.aquery_one(
        "SELECT item_level, catalog_version FROM hw_characters "
        "WHERE user_id=? AND character_name=?",
        (user_id, character),
    )
    version = catalog_version()
    if row is None or row["catalog_version"] == version:
        return False
    # 레벨을 모르면 추천이 거의 빈 목록으로 나온다. 멀쩡한 숙제를 지우느니 놔둔다.
    if row["item_level"] is None:
        return False

    await set_contents(user_id, character, [c.id for c in suggested_for(row["item_level"])])
    await db.aexecute(
        "UPDATE hw_characters SET catalog_version=? WHERE user_id=? AND character_name=?",
        (version, user_id, character),
    )
    return True


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
        # 카탈로그에서 난이도가 줄어들면 저장된 값이 범위를 넘을 수 있다
        states.append(TaskState(row["id"], content, min(cleared or 0, content.steps)))
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
    # 미클리어 -> 노말 -> 하드 -> ... -> 다시 미클리어로 한 바퀴 돈다.
    # 버튼이 하나뿐이라(Section accessory는 한 개) 난이도를 이렇게 고른다.
    cleared = row["cleared_gates"] if row["period_key"] == current else 0
    cleared = min(cleared or 0, content.steps) + 1
    if cleared > content.steps:
        cleared = 0

    await db.aexecute(
        "INSERT INTO hw_progress (task_id, period_key, cleared_gates, updated_at) VALUES (?,?,?,?) "
        "ON CONFLICT(task_id) DO UPDATE SET "
        "  period_key=excluded.period_key, cleared_gates=excluded.cleared_gates, "
        "  updated_at=excluded.updated_at",
        (task_id, current, cleared, int(time.time())),
    )
    return TaskState(task_id, content, cleared)


async def set_cleared(user_id: str, task_id: int, level: int) -> TaskState | None:
    """난이도를 골라서 찍는다. 이미 그 난이도면 해제한다.

    난이도마다 버튼이 따로 있으므로 toggle()처럼 한 바퀴 돌 필요가 없다.
    이미 켜진 걸 다시 누르는 게 유일한 해제 수단이라 그 경우만 0으로 되돌린다.
    """
    row = await db.aquery_one(
        "SELECT t.user_id, t.content_id, p.period_key, p.cleared_gates "
        "FROM hw_tasks t LEFT JOIN hw_progress p ON p.task_id=t.id WHERE t.id=?",
        (task_id,),
    )
    # 남의 숙제를 누르지 못하게 소유자를 반드시 확인한다
    if row is None or row["user_id"] != user_id:
        return None

    content = catalog().get(row["content_id"])
    if content is None or not 1 <= level <= content.steps:
        return None

    current = timez.period_key(content.cycle)
    was = row["cleared_gates"] if row["period_key"] == current else 0
    cleared = 0 if (was or 0) == level else level

    await db.aexecute(
        "INSERT INTO hw_progress (task_id, period_key, cleared_gates, updated_at) VALUES (?,?,?,?) "
        "ON CONFLICT(task_id) DO UPDATE SET "
        "  period_key=excluded.period_key, cleared_gates=excluded.cleared_gates, "
        "  updated_at=excluded.updated_at",
        (task_id, current, cleared, int(time.time())),
    )
    return TaskState(task_id, content, cleared)


async def owner_of(task_id: int) -> tuple[str, str] | None:
    """task의 (user_id, character_name). 소유자 확인과 화면 갱신에 쓴다."""
    row = await db.aquery_one(
        "SELECT user_id, character_name FROM hw_tasks WHERE id=?", (task_id,)
    )
    return (row["user_id"], row["character_name"]) if row else None


async def purge_stale() -> int:
    """지난 주기 기록 정리. 정확성은 읽기 시점 판정이 보장하므로 용량 관리용이다."""
    return await db.aexecute(
        "DELETE FROM hw_progress WHERE period_key NOT IN (?, ?)",
        (timez.daily_key(), timez.weekly_key()),
    )
