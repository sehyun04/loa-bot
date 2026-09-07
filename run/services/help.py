"""봇 자신에 대한 질답의 사실 자료.

라우터는 게임 수치를 지어내지 않는 대신 도구만 부른다. 그런데 '이 봇으로 뭘 할 수
있냐'는 질문에는 부를 도구가 없어서 매번 안내문으로 빠졌다. 이건 답이 레포 안에
있는 질문이라, 자료를 프롬프트에 실어 주면 지어낼 일 없이 문장으로 답할 수 있다.

자료가 코드와 어긋나면 그때부터는 거짓말이 되므로, 등록된 커맨드와 여기 목록이
일치하는지는 tests/test_help.py 가 지킨다.
"""

import json
from functools import lru_cache

from run.core import config


@lru_cache(maxsize=1)
def _data() -> dict:
    path = config.RESOURCE_DIR / "help.json"
    return json.loads(path.read_text(encoding="utf-8"))


def bot_facts() -> dict:
    return _data()["bot"]


def commands() -> tuple[dict, ...]:
    return tuple(_data()["commands"])


def command_names() -> tuple[str, ...]:
    return tuple(c["name"] for c in commands())


def command(name: str) -> dict | None:
    return next((c for c in commands() if c["name"] == name), None)


def visible() -> tuple[dict, ...]:
    """지금 실제로 등록된 커맨드만.

    로아 API 키가 없으면 그 커맨드들은 아예 안 붙는다(run/cogs/__init__.py).
    목록에 없는 걸 안내하면 그 순간부터 거짓말이 된다.
    """
    if config.has_lostark_api():
        return commands()
    return tuple(c for c in commands() if not c["needs_api"])


def grouped() -> list[tuple[str, list[dict]]]:
    """화면에 뿌릴 순서대로 (구역 이름, 커맨드들). 빈 구역은 내보내지 않는다."""
    out = []
    for group in _data()["groups"]:
        rows = [c for c in visible() if c["group"] == group]
        if rows:
            out.append((group, rows))
    return out


@lru_cache(maxsize=1)
def fact_sheet() -> str:
    """시스템 프롬프트에 실을 평문. 캐시에 태우므로 길이보다 정확도가 우선이다."""
    bot = bot_facts()
    lines = [f"## {bot['name']} - {bot['tagline']}", ""]
    lines += [f"- {f}" for f in bot["facts"]]
    for group, rows in grouped():
        lines += ["", f"### {group}"]
        for c in rows:
            lines.append(f"- `{c['usage']}` - {c['summary']}")
            lines += [f"  - {n}" for n in c["notes"]]
    return "\n".join(lines)
