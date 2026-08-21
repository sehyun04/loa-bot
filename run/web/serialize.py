"""도구 결과를 웹이 그릴 수 있는 형태로 옮긴다.

봇은 답변 문장을 만들지 않는다. 도구가 가져온 값을 Embed나 LayoutView가 직접
그리고, 모델은 어떤 도구를 부를지만 정한다. 그래서 웹에 붙일 때 재사용되는 건
"무엇을 보여줄지"까지고 "어떻게 보이는지"는 사이트가 다시 그린다.
여기가 그 경계다.

디스코드 객체의 속성 이름 대신 to_dict()/to_components()가 뱉는 와이어 포맷을
읽는다. 속성은 라이브러리 판올림에서 조용히 바뀌지만 와이어 포맷은 디스코드 API
스펙이라 바뀌면 봇이 먼저 터진다 - 우리가 모르고 지나갈 수가 없다.
"""

from typing import Any

import discord

# 디스코드 컴포넌트 타입 번호. 이름 상수가 라이브러리에 없어서 여기 적어둔다.
_ACTION_ROW = 1
_SECTION = 9
_TEXT = 10
_THUMBNAIL = 11
_SEPARATOR = 14
_CONTAINER = 17

# 조작이 있어야 의미가 생기는 컴포넌트. 웹에는 못 옮기므로 무엇을 뺐는지만 남긴다.
_INTERACTIVE = {_ACTION_ROW}


class Card(dict):
    """위젯이 카드 하나를 그리는 데 필요한 전부."""


def _hex(value: int | None) -> str | None:
    return f"#{value:06x}" if value else None


def _text_block(md: str) -> dict[str, Any] | None:
    md = (md or "").strip()
    return {"type": "text", "md": md} if md else None


def from_embed(embed: discord.Embed) -> Card:
    raw = embed.to_dict()
    blocks: list[dict[str, Any]] = []

    body = _text_block(raw.get("description") or "")
    if body:
        blocks.append(body)

    for field in raw.get("fields") or []:
        blocks.append(
            {
                "type": "field",
                "name": field.get("name") or "",
                "value": field.get("value") or "",
                "inline": bool(field.get("inline")),
            }
        )

    return Card(
        title=raw.get("title"),
        accent=_hex(raw.get("color")),
        thumbnail=(raw.get("thumbnail") or {}).get("url"),
        blocks=blocks,
        footer=(raw.get("footer") or {}).get("text"),
        omitted=[],
    )


def _walk(components: list[dict], card: Card, blocks: list[dict[str, Any]]) -> None:
    for comp in components:
        kind = comp.get("type")

        if kind in _INTERACTIVE:
            # 무엇이 빠졌는지는 위젯이 한 줄로 알려준다. 조용히 지우면
            # 디스코드에서는 되는 걸 웹에서 못 한다는 사실이 감춰진다.
            card["omitted"].append("조건을 바꾸는 버튼과 선택 메뉴")
            continue

        if kind == _CONTAINER:
            if card.get("accent") is None:
                card["accent"] = _hex(comp.get("accent_color"))
            _walk(comp.get("components") or [], card, blocks)

        elif kind == _SECTION:
            accessory = comp.get("accessory") or {}
            if accessory.get("type") == _THUMBNAIL and not card.get("thumbnail"):
                card["thumbnail"] = (accessory.get("media") or {}).get("url")
            _walk(comp.get("components") or [], card, blocks)

        elif kind == _TEXT:
            block = _text_block(comp.get("content") or "")
            if block:
                blocks.append(block)

        elif kind == _SEPARATOR:
            # 연속된 구분선은 하나로 접는다. 뺀 컴포넌트 자리에 선만 남으면
            # 화면에 근거 없는 빈칸이 생긴다.
            if comp.get("divider", True) and blocks and blocks[-1]["type"] != "divider":
                blocks.append({"type": "divider"})


def from_view(view: discord.ui.LayoutView) -> Card:
    card = Card(title=None, accent=None, thumbnail=None, blocks=[], footer=None, omitted=[])
    blocks: list[dict[str, Any]] = []
    _walk(view.to_components(), card, blocks)

    # 첫 블록이 제목 한 줄뿐이면 카드 제목으로 올린다. 본문에 남겨두면
    # Embed 쪽 카드와 생김새가 갈린다 - 같은 위젯이 두 모양을 그리게 된다.
    if blocks and blocks[0]["type"] == "text":
        head, _, rest = blocks[0]["md"].partition("\n")
        if head.startswith("#"):
            card["title"] = head.lstrip("# ").strip()
            if rest.strip():
                blocks[0]["md"] = rest.strip()
            else:
                blocks.pop(0)

    # 양끝 구분선을 턴다. 제목을 끌어올리거나 조작 컴포넌트를 뺀 자리에
    # 선만 남으면 화면에 근거 없는 빈칸이 생긴다.
    while blocks and blocks[0]["type"] == "divider":
        blocks.pop(0)
    while blocks and blocks[-1]["type"] == "divider":
        blocks.pop()

    card["omitted"] = sorted(set(card["omitted"]))
    card["blocks"] = blocks
    return card


def from_payload(payload: dict) -> Card:
    """ask.py 핸들러가 돌려주는 {"embed": ...} 또는 {"view": ...} 를 받는다."""
    if "embed" in payload:
        return from_embed(payload["embed"])
    if "view" in payload:
        return from_view(payload["view"])
    raise ValueError(f"옮길 수 없는 도구 결과: {sorted(payload)}")
