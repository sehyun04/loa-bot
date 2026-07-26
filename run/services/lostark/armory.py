import urllib.parse
from dataclasses import dataclass, field

from run.core import errors
from run.services.lostark.client import get_client

# 통합 엔드포인트는 filters로 필요한 것만 고를 수 있다. 지정하지 않으면
# 수집품/아바타/스킬까지 전부 와서 응답이 불필요하게 커진다.
CHARACTER_FILTERS = ("profiles", "equipment", "engravings", "gems", "cards", "arkpassive")

# 구분자는 실제 키로 1회 실측이 필요하다. 문서 예시와 서드파티 래퍼가 엇갈린다.
FILTER_SEPARATOR = "+"

PROFILE_TTL = 180.0
SIBLINGS_TTL = 600.0


def _to_float(value: str | float | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


@dataclass(frozen=True)
class Sibling:
    name: str
    server: str
    class_name: str
    level: int
    item_level: float | None


@dataclass
class Character:
    name: str
    server: str | None = None
    class_name: str | None = None
    level: int | None = None
    item_level: float | None = None
    combat_power: str | None = None
    expedition_level: int | None = None
    guild: str | None = None
    title: str | None = None
    image_url: str | None = None
    engravings: list[str] = field(default_factory=list)
    card_sets: list[str] = field(default_factory=list)
    gems: list[str] = field(default_factory=list)
    ark_passive: list[tuple[str, int]] = field(default_factory=list)


def _parse_profile(data: dict, char: Character) -> None:
    char.server = data.get("ServerName")
    char.class_name = data.get("CharacterClassName")
    char.level = data.get("CharacterLevel")
    char.item_level = _to_float(data.get("ItemAvgLevel"))
    char.combat_power = data.get("CombatPower")
    char.expedition_level = data.get("ExpeditionLevel")
    char.guild = data.get("GuildName")
    char.title = data.get("Title")
    char.image_url = data.get("CharacterImage")
    if data.get("CharacterName"):
        char.name = data["CharacterName"]


def _parse_engravings(data: dict, char: Character) -> None:
    # 아크패시브 개편 이후 각인은 ArkPassiveEffects 쪽에 담긴다
    for entry in data.get("ArkPassiveEffects") or []:
        name = entry.get("Name")
        level = entry.get("Level")
        grade = entry.get("Grade")
        if not name:
            continue
        label = name if level is None else f"{name} Lv.{level}"
        char.engravings.append(f"{label} ({grade})" if grade else label)

    if char.engravings:
        return
    for effect in data.get("Effects") or []:
        if effect.get("Name"):
            char.engravings.append(effect["Name"])


def _parse_cards(data: dict, char: Character) -> None:
    for effect in data.get("Effects") or []:
        items = effect.get("Items") or []
        if items:
            # 마지막 항목이 현재 활성화된 최상위 세트 효과다
            char.card_sets.append(items[-1].get("Name", ""))


def _parse_gems(data: dict, char: Character) -> None:
    counter: dict[str, int] = {}
    for gem in data.get("Gems") or []:
        level = gem.get("Level")
        if level is None:
            continue
        counter[f"{level}레벨"] = counter.get(f"{level}레벨", 0) + 1
    char.gems = [f"{k} {v}개" for k, v in sorted(counter.items(), key=lambda x: -int(x[0][:-2]))]


def _parse_ark_passive(data: dict, char: Character) -> None:
    for point in data.get("Points") or []:
        name, value = point.get("Name"), point.get("Value")
        if name and value is not None:
            char.ark_passive.append((name, value))


async def fetch_character(name: str) -> Character:
    client = get_client()
    quoted = urllib.parse.quote(name)
    filters = FILTER_SEPARATOR.join(CHARACTER_FILTERS)

    payload = await client.get(
        f"/armories/characters/{quoted}",
        params={"filters": filters},
        ttl=PROFILE_TTL,
        cache_key=f"armory:{name}",
    )

    # 없는 캐릭터에 404가 아니라 200 + null이 오는 경우가 있다
    if not payload:
        raise errors.CharacterNotFound(name)

    char = Character(name=name)
    if profile := payload.get("ArmoryProfile"):
        _parse_profile(profile, char)
    if engraving := payload.get("ArmoryEngraving"):
        _parse_engravings(engraving, char)
    if cards := payload.get("ArmoryCard"):
        _parse_cards(cards, char)
    if gems := payload.get("ArmoryGem"):
        _parse_gems(gems, char)
    if ark := payload.get("ArkPassive"):
        _parse_ark_passive(ark, char)

    if char.server is None and char.item_level is None:
        raise errors.CharacterNotFound(name)
    return char


async def fetch_siblings(name: str) -> list[Sibling]:
    client = get_client()
    quoted = urllib.parse.quote(name)
    payload = await client.get(
        f"/characters/{quoted}/siblings", ttl=SIBLINGS_TTL, cache_key=f"siblings:{name}"
    )
    if not payload:
        raise errors.CharacterNotFound(name)

    siblings = [
        Sibling(
            name=row.get("CharacterName", ""),
            server=row.get("ServerName", ""),
            class_name=row.get("CharacterClassName", ""),
            level=row.get("CharacterLevel", 0),
            item_level=_to_float(row.get("ItemAvgLevel")),
        )
        for row in payload
    ]
    return sorted(siblings, key=lambda s: s.item_level or 0, reverse=True)
