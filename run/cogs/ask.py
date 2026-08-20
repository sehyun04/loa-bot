import logging
import re

import anthropic
import discord
from discord.ext import commands

from run.core import config, errors
from run.services import auction, chat_session, hellreward, llm_router, refine, specup
from run.services.lostark import armory, market
from run.services.merchant import schedule as sch
from run.services.merchant import sightings
from run.services.merchant import wants as wants_svc
from run.utils import timez
from run.views import (
    character_view,
    common,
    hellreward_view,
    market_view,
    refine_view,
    specup_view,
)

log = logging.getLogger("loabot.ask")

# 디스코드 메시지 상한(2000자)보다 훨씬 짧게 끊는다. 라우터가 길게 답할 일이 없고,
# 길어졌다면 그건 라우팅 실패라 잘라 보내는 편이 낫다.
_MAX_TEXT = 400

# 도구 호출이 평문으로 샐 때 나오는 태그. 출력 직전에 무조건 한 번 거른다 -
# 탐지에 실패하더라도 이 XML이 사용자 화면에 뜨는 일만은 없어야 한다.
_TOOL_XML = re.compile(
    r"<\s*/?\s*(?:antml:)?(?:invoke|function_calls|parameter)\b[^>]*>", re.IGNORECASE
)


async def _market(item: str) -> dict:
    items = await market.search(item.strip())
    return {"embed": market_view.market_embed(item.strip(), items)}


async def _auction(bid: int, party_size: int, market_price: int | None = None) -> dict:
    if bid <= 0:
        return {"embed": common.error_embed("입력을 확인해주세요", "낙찰가는 1골드 이상이어야 해요.")}
    result = auction.calculate(bid, party_size)
    break_even = (
        auction.break_even_bid(market_price, party_size)
        if market_price and market_price > 0
        else None
    )
    return {"embed": market_view.auction_embed(result, break_even)}


async def _spec(name: str) -> dict:
    char = await armory.fetch_character(name.strip())
    return {"embed": character_view.character_embed(char)}


async def _roster(name: str) -> dict:
    rows = await armory.fetch_siblings(name.strip())
    return {"embed": character_view.siblings_embed(name.strip(), rows)}


async def _refine(
    item_type: str,
    target: int,
    grade: str = "t4_1730",
    jangin_percent: float = 0.0,
    prob_from_failure_percent: float = 0.0,
) -> dict:
    request = refine.Request(
        item_type=item_type,
        grade=grade,
        target=target,
        jangin=jangin_percent / 100,
        prob_from_failure=prob_from_failure_percent / 100,
    )
    try:
        report = await refine.report(request)
    except ValueError as exc:
        return {"view": common.error_view("계산할 수 없어요", str(exc))}
    return {"view": refine_view.RefineView(report)}


def _resolve_category(name: str, available: list[str]) -> str | None:
    """상자 이름을 이 층수의 실제 카테고리로 맞춘다.

    카탈로그는 '융화 재료'인데 사람은 '융화재료'라고 쓴다. 띄어쓰기만 다른 걸로
    되묻는 건 낭비라 여기서 흡수한다.
    """
    text = name.strip()
    if text in available:
        return text
    squished = text.replace(" ", "")
    for c in available:
        if c.replace(" ", "") == squished:
            return c
    hits = [c for c in available if squished in c.replace(" ", "")]
    return hits[0] if len(hits) == 1 else None


async def _hell_reward(tier: str, floor: int, categories: list[str] | None = None) -> dict:
    available = hellreward.categories_for(tier, floor)
    if len(available) < 2:
        return {"view": common.error_view("비교할 상자가 부족해요", "이 층수에는 상자 종류가 2개 미만이에요.")}

    # 사용자가 뜬 상자를 말했으면 고르는 단계를 건너뛰고 바로 비교해준다
    if categories:
        picked, unknown = [], []
        for raw in categories:
            resolved = _resolve_category(raw, available)
            if resolved is None:
                unknown.append(raw)
            elif resolved not in picked:
                picked.append(resolved)

        if unknown:
            return {
                "view": common.error_view(
                    "모르는 상자예요",
                    f"{', '.join(unknown)} 은(는) {floor}층에서 안 나와요.",
                )
            }
        if len(picked) >= 2:
            results = [await hellreward.evaluate(tier, floor, c) for c in picked]
            return {"view": hellreward_view.build_result_view(tier, floor, results)}
        # 하나만 지목했으면 비교가 성립하지 않으므로 선택 화면으로 넘긴다

    return {"view": hellreward_view.HellRewardPickView(tier, floor, available)}


async def _spec_up(name: str) -> dict:
    try:
        report = await specup.diagnose(name.strip())
    except errors.CharacterNotFound:
        return {"view": common.error_view("캐릭터를 못 찾았어요", f"`{name}` 이름을 다시 확인해주세요.")}
    return {"view": specup_view.build_report_view(report)}


def _resolve_card(name: str) -> str | list[str]:
    """카드 이름을 실제 카탈로그 값으로 맞춘다.

    133종 목록을 스키마에 넣으면 매 요청 토큰을 먹으므로, 모델은 자유 문자열로
    보내고 여기서 대조한다. 후보가 여럿이면 그대로 돌려줘 사용자가 고르게 한다.
    """
    names = sch.card_names()
    text = name.strip()
    if text in names:
        return text
    squished = text.replace(" ", "")
    exact = [n for n in names if n.replace(" ", "") == squished]
    if exact:
        return exact[0]
    partial = [n for n in names if squished in n.replace(" ", "")]
    return partial[0] if len(partial) == 1 else partial


async def _card_alert_set(message: discord.Message, server: str, card: str) -> dict:
    if message.guild is None:
        return {"view": common.error_view("여기선 안 돼요", "서버 채널에서만 등록할 수 있어요.")}

    resolved = _resolve_card(card)
    if isinstance(resolved, list):
        if not resolved:
            return {"view": common.error_view("모르는 카드예요", f"'{card}'는 카드 목록에 없어요.")}
        preview = ", ".join(resolved[:8])
        return {"view": common.notice_view("어떤 카드일까요", f"비슷한 게 여러 개예요: {preview}")}

    user_id = str(message.author.id)
    await wants_svc.add(
        user_id=user_id,
        guild_id=str(message.guild.id),
        channel_id=str(message.channel.id),
        server=server,
        card_name=resolved,
    )

    # 슬래시 커맨드와 동일하게, 지금 등장 중이면 이전 발송 기록을 지운다.
    # 안 그러면 재등록해도 이번 등장에는 알림이 안 간다.
    window = sch.active_window(timez.now())
    if window is not None:
        await sightings.unclaim(f"cardalert:{window.id}:{user_id}:{server}:{resolved}")

    return {
        "view": common.base_view(
            "카드 알림을 등록했어요",
            f"**{server}**에서 **{resolved}**가 뜨면 이 채널에서 멘션해드릴게요.\n"
            "해제하려면 `/떠상카드해제` 또는 저를 멘션해서 말씀해주세요.",
        )
    }


async def _card_alert_remove(message: discord.Message, server: str, card: str) -> dict:
    resolved = _resolve_card(card)
    if isinstance(resolved, list):
        resolved = card.strip()  # 해제는 등록된 값과 맞으면 되므로 원문으로 시도한다

    removed = await wants_svc.remove(str(message.author.id), server, resolved)
    if removed:
        return {"view": common.notice_view("알림을 껐어요", f"**{server}** · {resolved} 알림을 더는 보내지 않아요.")}
    return {"view": common.notice_view("등록되어 있지 않아요", f"**{server}** · {resolved}는 등록한 적이 없어요.")}


async def _card_alert_list(message: discord.Message) -> dict:
    items = await wants_svc.for_user(str(message.author.id))
    if not items:
        return {"view": common.notice_view("등록된 알림이 없어요", "저를 멘션해서 카드 알림을 걸어보세요.")}
    lines = "\n".join(f"- **{w.server}** · {w.card_name}" for w in items)
    return {"view": common.base_view("등록해둔 카드 알림", lines)}


_HANDLERS = {
    "get_market_price": _market,
    "calculate_auction": _auction,
    "get_character_spec": _spec,
    "get_roster": _roster,
    "simulate_refine": _refine,
    "compare_hell_reward": _hell_reward,
    "diagnose_spec_up": _spec_up,
    "set_card_alert": _card_alert_set,
    "remove_card_alert": _card_alert_remove,
    "list_card_alerts": _card_alert_list,
}

# 쓰기 계열은 누가/어디서 요청했는지가 필요하다. 이 값은 모델이 아니라
# 디스코드 메시지에서만 온다 - 모델이 남의 구독을 건드릴 수 없다.
_NEEDS_CONTEXT = {"set_card_alert", "remove_card_alert", "list_card_alerts"}

# 로아 API 키가 없으면 아예 부를 수 없는 도구
_NEEDS_LOA_API = {
    "get_market_price",
    "simulate_refine",
    "get_character_spec",
    "get_roster",
    "compare_hell_reward",
    "diagnose_spec_up",
}


def _text_of(reply: anthropic.types.Message) -> str:
    return "".join(b.text for b in reply.content if b.type == "text").strip()


def _leaked_tool_call(reply: anthropic.types.Message, text: str) -> bool:
    """도구를 부르려다 평문으로 샌 응답인지 본다.

    실측된 모양은 stop_reason이 tool_use인데 정작 tool_use 블록이 없는 것이다.
    태그 문자열만 보면 변종을 놓치므로 stop_reason을 먼저 본다.
    """
    if any(b.type == "tool_use" for b in reply.content):
        return False
    return reply.stop_reason == "tool_use" or bool(_TOOL_XML.search(text))


async def _run_tool(name: str, args: dict, message: discord.Message) -> dict:
    if name in _NEEDS_LOA_API and not config.has_lostark_api():
        return {"embed": common.api_key_missing_embed()}

    handler = _HANDLERS.get(name)
    if handler is None:
        log.warning("알 수 없는 도구: %s", name)
        return {"embed": common.error_embed("처리하지 못했어요", "지원하지 않는 요청이에요.")}

    try:
        if name in _NEEDS_CONTEXT:
            return await handler(message, **args)
        return await handler(**args)
    except errors.Maintenance:
        return {"embed": common.notice_embed("점검 중이에요", "잠시 후 다시 시도해주세요.")}
    except errors.LoaApiError as exc:
        return {"embed": common.error_embed("조회 실패", str(exc))}
    except (TypeError, ValueError) as exc:
        # 모델이 인자를 잘못 채운 경우. 스택트레이스 대신 사람이 읽을 메시지를 준다.
        log.info("도구 인자 오류 %s(%s): %s", name, args, exc)
        return {"embed": common.error_embed("계산할 수 없어요", str(exc))}


class AskCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or self.bot.user is None:
            return
        # message_content 특권 인텐트가 없어도 '봇을 멘션한 메시지'는 본문이 온다.
        # 그래서 멘션을 트리거로 쓴다.
        if self.bot.user not in message.mentions:
            return

        # 멘션 메시지는 특권 인텐트 없이도 본문이 와야 한다. 비어 있으면
        # 인텐트 문제이므로 로그로 구분할 수 있게 남긴다.
        if not message.content:
            log.warning("멘션인데 본문이 비어 있음 (message_content 인텐트 필요)")
            return

        question = message.content
        for mention in (f"<@{self.bot.user.id}>", f"<@!{self.bot.user.id}>"):
            question = question.replace(mention, " ")
        question = question.strip()
        if not question:
            return

        if not llm_router.available():
            await message.reply(
                embed=common.notice_embed(
                    "아직 준비 중이에요", "자연어 질문 기능이 설정되지 않았어요. 슬래시 커맨드를 써주세요."
                ),
                mention_author=False,
            )
            return

        log.info("질문 수신: %s", question)

        channel_id = str(message.channel.id)
        user_id = str(message.author.id)
        msgs = chat_session.history(channel_id, user_id) + [
            {"role": "user", "content": question}
        ]

        async with message.channel.typing():
            try:
                reply = await llm_router.route(msgs)
                calls = [b for b in reply.content if b.type == "tool_use"]
                text = _text_of(reply)

                # 도구를 부르겠다고 정해놓고 tool_use 블록 대신 <invoke> XML을 텍스트로
                # 흘리는 실패가 드물게 있다. 확률적이라 같은 질문을 한 번 더 물으면
                # 대개 제대로 온다 - 2초를 한 번 더 쓸 값어치가 있다.
                leaked = _leaked_tool_call(reply, text)
                if leaked:
                    log.warning("도구 호출이 평문으로 새어나옴, 재시도")
                    reply = await llm_router.route(msgs)
                    calls = [b for b in reply.content if b.type == "tool_use"]
                    text = _text_of(reply)
                    leaked = _leaked_tool_call(reply, text)
            except anthropic.BadRequestError as exc:
                # 이력이 원인일 수 있다. 대화 기억보다 이번 질문에 답하는 게 우선이다.
                log.warning("요청 거부(400): %s", exc.message)
                chat_session.forget(channel_id, user_id)
                reply = await llm_router.route([{"role": "user", "content": question}])
                calls = [b for b in reply.content if b.type == "tool_use"]
                text = _text_of(reply)
                leaked = _leaked_tool_call(reply, text)
            except anthropic.RateLimitError:
                await message.reply(
                    embed=common.notice_embed("잠시만요", "요청이 몰렸어요. 조금 뒤에 다시 물어봐 주세요."),
                    mention_author=False,
                )
                return
            except anthropic.APIStatusError as exc:
                log.warning("라우팅 실패 (%s): %s", exc.status_code, exc.message)
                await message.reply(
                    embed=common.error_embed("처리하지 못했어요", "잠시 후 다시 시도해주세요."),
                    mention_author=False,
                )
                return
            except anthropic.APIConnectionError:
                log.warning("라우팅 연결 실패")
                await message.reply(
                    embed=common.error_embed("처리하지 못했어요", "잠시 후 다시 시도해주세요."),
                    mention_author=False,
                )
                return

            if not calls:
                # 도구를 못 고른 경우 - 되묻거나 범위를 안내하는 문장이 온다
                answer = _TOOL_XML.sub("", text).strip()[:_MAX_TEXT]
                if leaked or not answer:
                    # 재시도까지 샌 응답. 잔해를 기억에 남기면 다음 턴까지 오염된다.
                    await message.reply(
                        "잘 못 알아들었어요. 다시 한 번 말씀해주시겠어요?", mention_author=False
                    )
                    return
                await message.reply(answer, mention_author=False)
                # 되물었으면 다음 한 마디가 그 답이다. 기억해둬야 이어받을 수 있다.
                chat_session.remember(channel_id, user_id, question, answer)
                return

            # 무엇을 요청했는지만 남긴다. 결과는 뷰가 보여주므로 맥락에는 필요 없다.
            chat_session.remember(
                channel_id,
                user_id,
                question,
                chat_session.summarize_calls([(c.name, dict(c.input)) for c in calls]),
            )

            for call in calls:
                log.info("라우팅: %s(%s)", call.name, dict(call.input))
                payload = await _run_tool(call.name, dict(call.input), message)
                await message.reply(**payload, mention_author=False)
