import json
import re
from functools import lru_cache

import discord

from run.core import config

BRAND = discord.Color(0xC8963E)
DANGER = discord.Color(0xD64545)
MUTED = discord.Color(0x6E7681)


_EMOJI_ID = re.compile(r":(\d+)>$")


@lru_cache(maxsize=1)
def _ui_emoji_map() -> dict[str, str]:
    """아이콘 이름 -> 인라인 이모지 태그.

    scripts/upload_ui_emojis.py 가 사람이 읽을 수 있는 풀네임으로 남긴 걸 여기서
    `<:e:id>` 로 줄인다. 이유는 schedule._item_emoji 와 같다 — 렌더링엔 ID만 있으면
    되는데 풀네임은 20자가 넘고, 메시지 4000자 한도에 항목 개수만큼 곱절로 새 나간다.
    """
    path = config.RESOURCE_DIR / "ui_emoji.json"
    if not path.is_file():
        return {}
    raw: dict[str, str] = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for key, tag in raw.items():
        m = _EMOJI_ID.search(tag)
        out[key] = f"<:e:{m.group(1)}>" if m else tag
    return out


def ui_emoji(name: str) -> str:
    """업로드 전이거나 매핑이 없으면 조용히 빈 문자열 — 호출부가 텍스트로 되돌린다."""
    return _ui_emoji_map().get(name, "")


def base_embed(title: str, description: str | None = None, **kwargs) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=BRAND, **kwargs)


def error_embed(title: str, description: str) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=DANGER)


def notice_embed(title: str, description: str) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=MUTED)


def _notice_view(title: str, description: str, colour: discord.Colour) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(f"## {title}\n{description}"),
        accent_colour=colour,
    ))
    return view


def base_view(title: str, description: str) -> discord.ui.LayoutView:
    return _notice_view(title, description, BRAND)


def error_view(title: str, description: str) -> discord.ui.LayoutView:
    return _notice_view(title, description, DANGER)


def notice_view(title: str, description: str) -> discord.ui.LayoutView:
    return _notice_view(title, description, MUTED)


def api_key_missing_embed() -> discord.Embed:
    return error_embed(
        "로스트아크 API 키가 없어요",
        "이 기능은 공식 API가 필요해요.\n"
        "`.env`의 `LOSTARK_API_KEY`를 채우면 바로 쓸 수 있어요.\n"
        "발급: https://developer-lostark.game.onstove.com/clients",
    )


def api_key_missing_view() -> discord.ui.LayoutView:
    return error_view(
        "로스트아크 API 키가 없어요",
        "이 기능은 공식 API가 필요해요.\n"
        "`.env`의 `LOSTARK_API_KEY`를 채우면 바로 쓸 수 있어요.\n"
        "발급: https://developer-lostark.game.onstove.com/clients",
    )
