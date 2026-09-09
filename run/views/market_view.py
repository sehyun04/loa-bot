"""거래소 시세·경매 계산 화면 (Components V2).

Container 구조:
    /시세  Container 1: 물어본 아이템 (이름·최저가, 썸네일)
           Container 2: 같이 걸린 것 + 단서
    /경매  Container 1: 무엇을 계산했는지 (낙찰가·인원)
           Container 2: 실부담과 분배금
           Container 3: 손익분기 (시세를 같이 넣었을 때만)

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
"""

import discord

from run.services.auction import MARKET_FEE, BidResult
from run.services.lostark.market import MarketItem
from run.views import common

# 검색은 기본 8건까지라 컴포넌트 40개에는 한참 못 미치지만, 호출부가 limit 을 올려도
# 화면이 안 터지게 여기서 한 번 더 자른다.
MAX_ROWS = 8

_SMALL = discord.SeparatorSpacing.small
_LARGE = discord.SeparatorSpacing.large


def _gold(value: float) -> str:
    return f"**{value:,.0f}** 골드"


def _price(value: float) -> str:
    """개당 가격은 자릿수마다 필요한 소수 자리가 다르다.

    파편은 1골드가 안 돼서 정수로 반올림하면 0골드가 되고, 20골드짜리는 소수 한 자리가
    있어야 옆 물건과 비교가 된다. 천 단위부터는 소수점이 자릿수만 늘린다.
    """
    if value < 10:
        return f"{value:,.2f}"
    if value < 100:
        return f"{value:,.1f}"
    return f"{value:,.0f}"


def _grade(item: MarketItem) -> str:
    return f"`{item.grade}` " if item.grade else ""


def _norm(text: str) -> str:
    return text.replace(" ", "").lower()


def _exact(query: str, items: list[MarketItem]) -> MarketItem | None:
    """이름이 그대로 맞는 게 있으면 그게 답이다.

    검색 결과는 최저가 오름차순이라 맨 위가 물어본 아이템이라는 보장이 없다. 그냥
    첫 줄을 크게 뽑으면 '돌파석' 을 물었는데 엉뚱한 싸구려가 답처럼 커진다.
    자동완성이 전체 이름을 넣어주므로 대개는 여기서 걸린다.
    """
    target = _norm(query)
    return next((i for i in items if _norm(i.name) == target), None)


def _bundle_note(item: MarketItem) -> str | None:
    if item.bundle_count <= 1:
        return None
    return f"{item.bundle_count}개 묶음 · 개당 {_price(item.unit_price)}골드"


def _trend_note(item: MarketItem) -> str | None:
    """지금 사도 되는지는 절대 가격보다 어제 평균과의 거리가 먼저 답한다."""
    avg = item.yesterday_avg_price
    if not avg:
        return None
    gap = item.current_min_price / avg - 1
    if abs(gap) < 0.01:
        return f"어제 평균 {_price(avg)}골드와 비슷"
    return f"어제 평균 {_price(avg)}골드보다 {abs(gap) * 100:.0f}% {'높음' if gap > 0 else '낮음'}"


def _notes(item: MarketItem) -> str:
    notes = [n for n in (_bundle_note(item), _trend_note(item)) if n]
    return "\n-# " + " · ".join(notes) if notes else ""


def _hero(item: MarketItem) -> discord.ui.Item:
    text = discord.ui.TextDisplay(
        f"# {item.name}\n{_grade(item)}최저 {_gold(item.current_min_price)}{_notes(item)}"
    )
    # Section 은 accessory 가 필수다 - 아이콘이 없으면 Section 없이 텍스트만 넣는다.
    if not item.icon:
        return text
    return discord.ui.Section(text, accessory=discord.ui.Thumbnail(media=item.icon))


def _head(query: str, items: list[MarketItem]) -> discord.ui.Item:
    """이름이 정확히 맞는 게 없을 때의 머리말. 답을 고르지 않고 검색어만 세운다."""
    text = discord.ui.TextDisplay(f"# {query}\n거래소에서 {len(items)}건 찾았어요")
    icon = next((i.icon for i in items if i.icon), None)
    if not icon:
        return text
    return discord.ui.Section(text, accessory=discord.ui.Thumbnail(media=icon))


def _row(item: MarketItem) -> str:
    # 이름이 아니라 값을 굵게 한다. 이름은 등급 스팬이 이미 붙잡아 주고, 목록을
    # 훑을 때 눈이 좇는 건 결국 가격이다.
    return f"{_grade(item)}{item.name}  ·  {_gold(item.current_min_price)}{_notes(item)}"


def _footnote(items: list[MarketItem], ranked: bool) -> str:
    notes = ["거래소 최저가 기준"]
    if ranked:
        notes[0] = "거래소 최저가 오름차순"
    if any(i.bundle_count > 1 for i in items):
        notes.append("묶음 상품은 개당 가격으로 견주세요")
    return "-# " + " · ".join(notes)


def price_view(query: str, items: list[MarketItem]) -> discord.ui.LayoutView:
    if not items:
        return common.notice_view(
            "찾지 못했어요",
            # 이름 뒤에 조사를 붙이면 받침에 따라 '이라는/라는' 이 갈린다. 줄표로 끊어
            # 조사가 안 붙게 한다.
            f"`{query}` — 거래소에서 이 이름을 찾지 못했어요. 철자를 한 번만 더 봐주시겠어요.",
        )

    view = discord.ui.LayoutView()
    hero = _exact(query, items)
    rest = [i for i in items if i is not hero]
    head: list[discord.ui.Item] = [_hero(hero) if hero else _head(query, items)]

    # 뒤따르는 목록이 없으면 각주만 든 카드가 하나 더 생긴다. 잔글씨 한 줄이 카드를
    # 통째로 차지하는 꼴이라 머리말 카드 안으로 들인다.
    if not rest:
        head.append(discord.ui.TextDisplay(_footnote(items, ranked=False)))
        view.add_item(discord.ui.Container(*head))
        return view

    view.add_item(discord.ui.Container(*head))

    shown = rest[:MAX_ROWS]
    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay("### 같이 걸린 것" if hero else "### 검색 결과"),
        discord.ui.Separator(),
    ]
    for item in shown:
        # 항목마다 잔글씨가 붙어서, 그냥 이어 붙이면 어디서 한 항목이 끝나는지 안 보인다.
        if len(body) > 2:
            body.append(discord.ui.Separator(spacing=_SMALL))
        body.append(discord.ui.TextDisplay(_row(item)))
    if len(rest) > len(shown):
        body.append(discord.ui.TextDisplay(f"-# 외 {len(rest) - len(shown)}건"))

    body += [
        discord.ui.Separator(spacing=_LARGE),
        discord.ui.TextDisplay(_footnote(items, ranked=True)),
    ]
    view.add_item(discord.ui.Container(*body))
    return view


def _cost(result: BidResult) -> list[discord.ui.Item]:
    return [
        discord.ui.TextDisplay("### 실제로 나가는 돈"),
        discord.ui.Separator(),
        discord.ui.TextDisplay(
            f"`내 부담` {_gold(result.winner_cost)}\n"
            f"-# 낙찰가에서 내 몫 {result.share_per_member:,}골드를 도로 받아요"
        ),
        discord.ui.Separator(spacing=_SMALL),
        discord.ui.TextDisplay(
            f"`1인당 분배금` {_gold(result.share_per_member)}\n"
            f"-# 낙찰자까지 {result.party_size}명이 똑같이 나눠 가져요"
        ),
    ]


def _break_even(result: BidResult, break_even: int) -> list[discord.ui.Item]:
    gap = break_even - result.bid
    if gap > 0:
        verdict = f"**{gap:,}골드** 더 불러도 남아요"
    elif gap == 0:
        verdict = "딱 여기까지예요"
    else:
        verdict = f"이미 **{-gap:,}골드** 넘겼어요"
    return [
        discord.ui.TextDisplay("### 손익분기"),
        discord.ui.Separator(),
        discord.ui.TextDisplay(
            f"`한계 입찰가` {_gold(break_even)} · {verdict}\n"
            f"-# 거래소에 팔아 수수료 {MARKET_FEE:.0%} 를 떼고 남는 돈과 같아지는 지점이에요"
        ),
    ]


def auction_view(result: BidResult, break_even: int | None) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(discord.ui.TextDisplay(
        f"# {result.bid:,} 골드 낙찰\n{result.party_size}인 파티에서 이 값에 가져갔을 때"
    )))
    view.add_item(discord.ui.Container(*_cost(result)))
    if break_even is not None:
        view.add_item(discord.ui.Container(*_break_even(result, break_even)))
    return view
