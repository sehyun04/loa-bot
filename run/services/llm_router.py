"""자연어 질문을 기존 서비스 호출로 라우팅한다.

모델은 '어떤 함수를 어떤 인자로 부를지'만 정하고, 답변 문장은 만들지 않는다.
결과 렌더링은 기존 뷰가 그대로 담당하므로 모델이 사실을 지어낼 여지가 없다.
"""

import logging
from typing import Any

import anthropic

from run.core import config
from run.services import hellreward as hr
from run.services.merchant import schedule as sch

log = logging.getLogger("loabot.llm")

_client: anthropic.AsyncAnthropic | None = None


def available() -> bool:
    return bool(config.ANTHROPIC_API_KEY)


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


SYSTEM = (
    "너는 로스트아크 디스코드 봇의 라우터다. 사용자의 한국어 질문을 읽고 "
    "적절한 도구를 호출하는 것이 유일한 임무다.\n"
    "\n"
    "- 도구로 처리할 수 있으면 반드시 도구를 호출한다. 답을 직접 지어내지 않는다.\n"
    "- 시세, 골드, 아이템 레벨 같은 수치는 절대 추측하지 않는다. 전부 도구가 가져온다.\n"
    "- 질문 하나에 요청이 여러 개면 도구를 여러 개 동시에 호출한다.\n"
    "- 맞는 도구가 없으면 도구를 부르지 말고, 무엇을 할 수 있는지 한국어 두 문장 이내로 답한다.\n"
    "- 어떤 도구를 부를지 정하기에 정보가 부족하면 되묻는다.\n"
    "- 말투는 해요체로 통일한다. 반말('알려줘', '해줄게')을 쓰지 않는다.\n"
    "  봇의 다른 화면이 전부 해요체라 반말이 섞이면 튄다.\n"
    "- 이모지를 쓰지 않는다."
)

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_market_price",
        "description": (
            "로스트아크 거래소에서 아이템 시세를 조회한다. "
            "'돌파석 얼마', '운명의파괴석 시세', '재련재료 값' 처럼 "
            "아이템 가격을 묻는 질문에 사용한다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "item": {
                    "type": "string",
                    "description": (
                        "조회할 아이템 이름. 사용자가 '시세', 'ㅅㅅ', '얼마' 같은 "
                        "질문 표현을 섞어 써도 아이템 이름만 남겨서 넣는다."
                    ),
                }
            },
            "required": ["item"],
        },
    },
    {
        "name": "calculate_auction",
        "description": (
            "경매 낙찰가로 실부담금과 파티 분배금을 계산한다. "
            "'8인 30만에 먹었는데 얼마 내야 해', '분배금 계산' 같은 질문에 사용한다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "bid": {
                    "type": "integer",
                    "description": "낙찰가(골드). '30만'은 300000으로 변환해서 넣는다.",
                },
                "party_size": {
                    "type": "integer",
                    "enum": [4, 8],
                    "description": "파티 인원. 언급이 없으면 8을 쓴다.",
                },
                "market_price": {
                    "type": "integer",
                    "description": "거래소 시세(골드). 사용자가 알려준 경우에만 넣으면 손익분기까지 계산된다.",
                },
            },
            "required": ["bid", "party_size"],
        },
    },
    {
        "name": "get_character_spec",
        "description": (
            "캐릭터 한 명의 아이템 레벨과 세팅을 조회한다. "
            "'김세현 스펙 봐줘', '이 캐릭 몇렙이야' 같은 질문에 사용한다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "캐릭터 닉네임"}
            },
            "required": ["name"],
        },
    },
    {
        "name": "get_roster",
        "description": (
            "같은 계정에 속한 캐릭터 목록(원정대)을 조회한다. "
            "'원정대 보여줘', '이 사람 부캐 뭐 있어' 같은 질문에 사용한다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "기준이 될 캐릭터 닉네임"}
            },
            "required": ["name"],
        },
    },
    {
        "name": "simulate_refine",
        "description": (
            "재련 성공까지 평균 몇 번 시도하고 골드가 얼마나 드는지 계산한다. "
            "'무기 22강 얼마나 들어', '방어구 20강 재료' 같은 질문에 사용한다. "
            "성공 확률과 재료 수량은 봇이 표에서, 시세는 거래소에서 직접 가져오므로 "
            "부위와 목표 단계만 있으면 된다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "item_type": {
                    "type": "string",
                    "enum": ["weapon", "armor"],
                    "description": "무기면 weapon, 방어구(투구·상의·하의·장갑·어깨)면 armor",
                },
                "target": {
                    "type": "integer",
                    "description": "목표 단계. '22강'이면 22 - +21에서 +22로 가는 계산이다.",
                },
                "grade": {
                    "type": "string",
                    "enum": ["t4_1730", "t4_1590", "t3_1525", "t3_1390", "t3_1250"],
                    "description": "장비 등급. 언급이 없으면 최신 등급인 t4_1730.",
                },
                "jangin_percent": {
                    "type": "number",
                    "description": "지금까지 쌓인 장인의 기운(%). 언급이 없으면 0.",
                },
                "prob_from_failure_percent": {
                    "type": "number",
                    "description": "실패가 쌓여 이미 올라간 확률(%). 언급이 없으면 0.",
                },
            },
            "required": ["item_type", "target"],
        },
    },
    {
        "name": "set_card_alert",
        "description": (
            "떠돌이 상인이 특정 카드를 팔면 알려주도록 알림을 등록한다. "
            "'아브렐슈드 카드 뜨면 알려줘', '카드알림 걸어줘' 같은 요청에 사용한다. "
            "등록은 요청한 사람과 그 채널에 묶이므로 사용자 정보는 넣지 않는다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "enum": list(sch.servers()),
                    "description": "감시할 서버 이름",
                },
                "card": {
                    "type": "string",
                    "description": (
                        "기다리는 카드 이름. 주의: 일부 카드 이름은 서버 이름과 같다"
                        "(예: 아브렐슈드는 서버이자 카드다). '루페온 서버 아브렐슈드 카드'처럼 "
                        "둘 다 나오면 server와 card를 문맥에 맞게 각각 채운다."
                    ),
                },
            },
            "required": ["server", "card"],
        },
    },
    {
        "name": "remove_card_alert",
        "description": "등록해둔 떠상 카드 알림을 해제한다. '카드알림 꺼줘', '해제해줘' 같은 요청에 사용한다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "enum": list(sch.servers()),
                    "description": "해제할 서버 이름",
                },
                "card": {"type": "string", "description": "해제할 카드 이름"},
            },
            "required": ["server", "card"],
        },
    },
    {
        "name": "compare_hell_reward",
        "description": (
            "지옥 보상 상자 중 뭐가 이득인지 비교한다. "
            "'1730 지옥보상 뭐 먹지', '지옥 80층 보상 뭐가 나아' 같은 질문에 사용한다. "
            "사용자가 어떤 상자가 떴는지 말했으면 categories 에 그 이름들을 넣어 "
            "바로 답이 나오게 한다. "
            "티어와 층수가 모두 있어야 계산할 수 있으므로, 하나라도 없으면 되묻는다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "tier": {
                    "type": "string",
                    "enum": list(hr.TIERS),
                    "description": "사용한 지옥 열쇠 단계. 아이템 레벨 숫자로 부른다(1730 등).",
                },
                "floor": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "description": "최종 도달 층수 (1~100)",
                },
                "categories": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "사용자가 실제로 뜬 상자를 말했다면 그 이름들을 넣는다. "
                        "넣으면 바로 비교 결과가 나오고, 비우면 사용자가 직접 고르는 "
                        "선택 화면이 뜬다. 사용자가 상자를 지목했는데 비워두면 "
                        "이미 말한 걸 또 고르게 만드는 셈이라 반드시 채운다. "
                        "가능한 값: 어빌리티 스톤 키트, 특수 재련, 젬 선택, 젬 랜덤, "
                        "재련 보조, 융화 재료, 운명/혼돈의 돌 선택, 파괴석/수호석 선택, "
                        "팔찌, 귀속 골드, 천상 도전권, 돌파석. "
                        "띄어쓰기가 달라도 그대로 넣으면 서버가 맞춰준다."
                    ),
                },
            },
            "required": ["tier", "floor"],
        },
    },
    {
        "name": "diagnose_spec_up",
        "description": (
            "캐릭터를 보고 지금 뭐부터 올리면 좋을지 뒤처진 순서로 진단한다. "
            "'뭐부터 올려야 해', '스펙업 뭐 하지' 같은 질문에 사용한다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "진단할 캐릭터 닉네임"}
            },
            "required": ["name"],
        },
    },
    {
        "name": "list_card_alerts",
        "description": "내가 등록해둔 떠상 카드 알림 목록을 본다. '뭐 걸어놨지', '알림 목록' 같은 요청에 사용한다.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


async def route(messages: list[dict]) -> anthropic.types.Message:
    """대화 이력을 모델에 보내고 응답 메시지를 그대로 돌려준다.

    도구 결과를 모델에 되돌려주지 않는다 - 렌더링은 뷰가 하므로 왕복 1회로 끝난다.

    thinking과 effort를 지정하지 않는다. adaptive + effort=low 조합에서 도구 호출이
    tool_use 블록 대신 텍스트에 <invoke> XML로 새어나오는 일이 12회 중 2회 재현됐고,
    그때 stop_reason은 tool_use인데 정작 tool_use 블록이 없어 호출이 통째로 유실된다.
    두 옵션을 빼면 30회 중 누출 0이면서 지연 중앙값은 1.9초로 같았다(2026-08-17 실측).

    옵션을 뺐다고 사고가 꺼진 게 아니다 - 안 적으면 adaptive가 기본이라 응답에
    thinking 블록이 그대로 온다(실측 확인). effort=low로 되돌리지 말 것, 그게 새던
    설정이다. 참고로 이 모델은 thinking.type=enabled를 400으로 거부한다.
    """
    return await _get_client().messages.create(
        model=config.ANTHROPIC_MODEL,
        max_tokens=4096,
        # 도구 스키마와 시스템 프롬프트는 매 요청 동일하므로 캐시에 태운다
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        tools=TOOLS,
        messages=messages,
    )
