"""포트폴리오 사이트의 니나브 위젯이 부르는 질의응답.

디스코드 멘션 대화(run/cogs/ask.py)와 같은 라우터, 같은 도구 핸들러를 쓴다.
핸들러를 여기서 다시 짜면 두 벌이 갈라져 같은 질문에 다른 답이 나가고,
그때 어느 쪽이 맞는지 판단할 근거가 없어진다. 그래서 ask.py의 것을 그대로
가져다 쓴다 - 밑줄로 시작하는 이름이지만 같은 저장소 안이고, 복제본을
만드는 쪽이 훨씬 위험하다.
"""

import asyncio
import logging

import anthropic

from run.cogs.ask import (
    _HANDLERS,
    _MAX_TEXT,
    _NEEDS_CONTEXT,
    _NEEDS_LOA_API,
    _TOOL_XML,
    _leaked_tool_call,
    _text_of,
)
from run.core import config, errors
from run.services import chat_session, llm_router
from run.web import serialize

log = logging.getLogger("loabot.web")

# 웹에서 뺀 도구와 그 이유.
#
# 카드알림 3종은 "누가, 어느 채널에서" 요청했는지가 있어야 하는데 그 값은
# 디스코드 메시지에서만 온다. 웹 방문자에게 임의의 유저 ID를 붙이면 남의
# 구독을 건드릴 수 있다.
#
# compare_hell_reward는 상자를 고르는 버튼 화면으로 시작한다. 조작이 없으면
# 첫 화면에서 더 나아가지 못하므로 절반짜리 답이 된다.
_WEB_EXCLUDED = _NEEDS_CONTEXT | {"compare_hell_reward"}

WEB_TOOLS = {name: fn for name, fn in _HANDLERS.items() if name not in _WEB_EXCLUDED}

# 라우터에게도 뺀 도구를 숨긴다. 스키마에 남겨두면 모델이 그걸 고르고,
# 우리는 "그건 디스코드에서만 돼요"를 매번 돌려줘야 한다 - 토큰과 지연을
# 쓰고 나서 못 한다고 답하는 셈이다.
WEB_TOOL_SCHEMAS = [t for t in llm_router.TOOLS if t["name"] in WEB_TOOLS]

# 위젯 입력창도 막지만 여기서 한 번 더 자른다. 프록시를 건너뛴 요청이
# 긴 프롬프트를 그대로 밀어 넣는 걸 막는 마지막 지점이다.
MAX_QUESTION = 200

# 도구가 로아 API를 여러 번 때릴 수 있어 넉넉히 잡되, 무한정 붙들지는 않는다.
TOOL_TIMEOUT = 25.0


class Unavailable(Exception):
    """지금은 답할 수 없다 - 위젯이 재생 모드로 내려갈 신호."""


async def _route(messages: list[dict]):
    return await llm_router._get_client().messages.create(
        model=config.ANTHROPIC_MODEL,
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": llm_router.SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=WEB_TOOL_SCHEMAS,
        messages=messages,
    )


async def _run_tool(name: str, args: dict) -> dict:
    if name in _NEEDS_LOA_API and not config.has_lostark_api():
        raise Unavailable("로스트아크 API 키가 없어요")

    handler = WEB_TOOLS.get(name)
    if handler is None:
        # 스키마에서 뺐는데도 모델이 골랐다면 라우터 쪽에 구멍이 있는 것이다.
        log.warning("웹에서 허용하지 않은 도구: %s", name)
        raise ValueError("지원하지 않는 요청이에요.")

    async with asyncio.timeout(TOOL_TIMEOUT):
        payload = await handler(**args)
    return serialize.from_payload(payload)


async def answer(session_id: str, question: str) -> dict:
    """한 번의 질문에 대한 응답. 위젯이 그대로 그릴 수 있는 모양으로 돌려준다."""
    question = (question or "").strip()[:MAX_QUESTION]
    if not question:
        raise ValueError("질문이 비어 있어요.")
    if not llm_router.available():
        raise Unavailable("자연어 질문이 설정되지 않았어요")

    messages = chat_session.history("web", session_id) + [
        {"role": "user", "content": question}
    ]

    try:
        reply = await _route(messages)
        calls = [b for b in reply.content if b.type == "tool_use"]
        text = _text_of(reply)

        # 디스코드 쪽과 같은 실패 모드다 - 도구를 부르겠다고 정해놓고 tool_use
        # 블록 대신 XML을 텍스트로 흘린다. 확률적이라 한 번 더 물으면 대개 온다.
        if _leaked_tool_call(reply, text):
            log.warning("도구 호출이 평문으로 새어나옴, 재시도")
            reply = await _route(messages)
            calls = [b for b in reply.content if b.type == "tool_use"]
            text = _text_of(reply)
            if _leaked_tool_call(reply, text):
                return {"reply": "잘 못 알아들었어요. 다시 한 번 말씀해주시겠어요?", "cards": []}
    except anthropic.BadRequestError as exc:
        # 이력이 원인일 수 있다. 기억을 버리고 이번 질문만으로 다시 간다.
        log.warning("요청 거부(400): %s", exc.message)
        chat_session.forget("web", session_id)
        reply = await _route([{"role": "user", "content": question}])
        calls = [b for b in reply.content if b.type == "tool_use"]
        text = _text_of(reply)
    except anthropic.RateLimitError as exc:
        raise Unavailable("요청이 몰렸어요") from exc
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        log.warning("라우팅 실패: %s", exc)
        raise Unavailable("모델에 연결하지 못했어요") from exc

    if not calls:
        answer_text = _TOOL_XML.sub("", text).strip()[:_MAX_TEXT]
        if not answer_text:
            return {"reply": "잘 못 알아들었어요. 다시 한 번 말씀해주시겠어요?", "cards": []}
        chat_session.remember("web", session_id, question, answer_text)
        return {"reply": answer_text, "cards": []}

    # 무엇을 요청했는지만 남긴다. 결과는 카드가 보여주므로 맥락에는 필요 없다.
    chat_session.remember(
        "web",
        session_id,
        question,
        chat_session.summarize_calls([(c.name, dict(c.input)) for c in calls]),
    )

    cards = []
    for call in calls:
        log.info("웹 라우팅: %s(%s)", call.name, dict(call.input))
        try:
            card = await _run_tool(call.name, dict(call.input))
        # CharacterNotFound와 Maintenance는 LoaApiError의 하위라 먼저 걸러야 한다
        except errors.Maintenance:
            card = _error_card("점검 중이에요", "잠시 후 다시 시도해주세요.")
        except errors.CharacterNotFound:
            card = _error_card("캐릭터를 못 찾았어요", "이름을 다시 확인해주세요.")
        except errors.LoaApiError as exc:
            card = _error_card("조회 실패", str(exc))
        except TimeoutError:
            log.warning("도구 시간 초과: %s", call.name)
            card = _error_card("시간이 초과됐어요", "로스트아크 API 응답이 늦어요. 다시 시도해주세요.")
        except (TypeError, ValueError) as exc:
            log.info("도구 인자 오류 %s: %s", call.name, exc)
            card = _error_card("계산할 수 없어요", str(exc))
        cards.append({"tool": call.name, **card})

    return {"reply": None, "cards": cards}


def _error_card(title: str, body: str) -> dict:
    return {
        "title": title,
        "accent": "#d64545",
        "thumbnail": None,
        "blocks": [{"type": "text", "md": body}],
        "footer": None,
        "omitted": [],
    }
