import json
import re
from dataclasses import dataclass
from datetime import date as date_cls
from datetime import datetime, time, timedelta
from functools import lru_cache

from run.core import config
from run.utils.timez import KST


_ICON_BASE = "https://cdn-lostark.game.onstove.com/"
_NO_EMOJI = ""
_EMOJI_ID = re.compile(r":(\d+)>$")


@dataclass(frozen=True)
class Item:
    # id는 kloa 제보 API의 itemIds와 맞물리는 키다. 표시용이 아니라 조인 키라 바꾸면 안 된다.
    id: str
    name: str
    type: str
    grade: int
    icon: str  # 로스트아크 공식 CDN 상대경로
    # 게임에 뜨지만 목록에는 감추는 항목(전설·영웅 호감도 같은 등급 표기용 더미)
    hidden: bool = False

    @property
    def icon_url(self) -> str:
        return _ICON_BASE + self.icon

    @property
    def emoji(self) -> str:
        """인라인용 작은 아이콘. scripts/upload_item_emojis.py로 미리 올려둔 봇 이모지.

        업로드 전이거나 새 아이템이라 매핑이 없으면 조용히 빈 문자열."""
        return _item_emoji().get(self.icon, _NO_EMOJI)


@dataclass(frozen=True)
class Region:
    id: str
    name: str
    npc: str
    group: int
    items: tuple[Item, ...]

    def items_of(self, kind: str) -> tuple[Item, ...]:
        return tuple(i for i in self.items if i.type == kind)


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime
    groups: tuple[int, ...]

    @property
    def id(self) -> str:
        return self.start.isoformat()

    def contains(self, moment: datetime) -> bool:
        return self.start <= moment < self.end


@lru_cache(maxsize=1)
def _data() -> dict:
    path = config.RESOURCE_DIR / "merchant.json"
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _item_emoji() -> dict[str, str]:
    """icon 경로 -> 인라인 이모지 태그.

    item_emoji.json에는 scripts/upload_item_emojis.py가 재실행 시 중복 업로드를
    피하려고 사람이 읽을 수 있는 풀네임(`<:loa_xxx:id>`)으로 저장돼 있다. 렌더링은
    ID만 있으면 되므로 여기서 이름을 한 글자로 줄인다 — 제보가 많은 서버는 지역 20곳
    안팎에 아이템이 아이콘까지 붙어 4000자 한도를 넘기기 쉬운데, 풀네임 하나가 보통
    20자 이상이라 이것만으로 아이템 개수만큼 곱절로 새 나간다.
    """
    path = config.RESOURCE_DIR / "item_emoji.json"
    if not path.is_file():
        return {}
    raw: dict[str, str] = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for icon, tag in raw.items():
        m = _EMOJI_ID.search(tag)
        out[icon] = f"<:e:{m.group(1)}>" if m else tag
    return out


@lru_cache(maxsize=1)
def all_regions() -> tuple[Region, ...]:
    return tuple(
        Region(
            id=r["id"],
            name=r["name"],
            npc=r["npc"],
            group=r["group"],
            items=tuple(
                Item(
                    id=str(i["id"]),
                    name=i["name"],
                    type=i["type"],
                    grade=i["grade"],
                    icon=i["icon"],
                    hidden=bool(i.get("hidden")),
                )
                for i in r["items"]
            ),
        )
        for r in _data()["regions"]
    )


def servers() -> tuple[str, ...]:
    return tuple(s["name"] for s in _data()["servers"])


def server_id(name: str) -> int | None:
    """서버 이름 → kloa 제보 API의 server 번호."""
    return next((s["id"] for s in _data()["servers"] if s["name"] == name), None)


@lru_cache(maxsize=1)
def _region_index() -> dict[str, Region]:
    return {r.id: r for r in all_regions()}


def region_by_id(region_id: str) -> Region | None:
    return _region_index().get(str(region_id))


def item_names(region_id: str, item_ids: tuple[str, ...] | list[str]) -> list[str]:
    """제보의 itemIds를 사람이 읽는 이름으로. 모르는 id는 조용히 버린다.

    게임 패치로 아이템이 추가되면 우리 merchant.json 보다 제보가 먼저 최신이 된다.
    그때 이름을 못 찾는다고 제보 전체를 버리면 안 되므로 아는 것만 살린다.
    """
    region = region_by_id(region_id)
    if region is None:
        return []
    wanted = {str(x) for x in item_ids}
    # 제보가 준 순서가 아니라 원본 지역 순서(카드 먼저)로 돌려준다. kloa 화면과 같은 배열이 된다.
    return [i.name for i in region.items if i.id in wanted]


def duration() -> timedelta:
    return timedelta(minutes=_data()["duration_minutes"])


def _windows_on(day: date_cls) -> list[Window]:
    """해당 날짜에 '시작하는' 윈도우들. 종료가 다음날로 넘어갈 수 있다."""
    # 원본 데이터가 JS Date.getDay() 기준이라 일요일이 0이다 (Python은 월요일이 0)
    js_weekday = (day.weekday() + 1) % 7
    span = duration()

    windows = []
    for entry in _data()["schedules"]:
        if entry["weekday"] != js_weekday:
            continue
        hour, minute = (int(x) for x in entry["start"].split(":"))
        start = datetime.combine(day, time(hour, minute), tzinfo=KST)
        windows.append(Window(start, start + span, tuple(entry["groups"])))
    return sorted(windows, key=lambda w: w.start)


def _nearby_windows(ref: datetime) -> list[Window]:
    """전날 윈도우를 반드시 포함한다.

    22시 시작 윈도우는 다음날 03:30에 끝난다. 새벽에 조회하면 적용할 스케줄은
    '오늘'이 아니라 '어제' 항목이므로, 오늘 날짜만 보면 활성 윈도우를 놓친다.
    """
    base = ref.astimezone(KST).date()
    windows: list[Window] = []
    for offset in (-1, 0, 1):
        windows.extend(_windows_on(base + timedelta(days=offset)))
    return sorted(windows, key=lambda w: w.start)


def active_window(ref: datetime) -> Window | None:
    return next((w for w in _nearby_windows(ref) if w.contains(ref)), None)


def next_window(ref: datetime) -> Window:
    return next(w for w in _nearby_windows(ref) if w.start > ref)


def regions_for(groups: tuple[int, ...] | list[int]) -> tuple[Region, ...]:
    wanted = set(groups)
    return tuple(r for r in all_regions() if r.group in wanted)
