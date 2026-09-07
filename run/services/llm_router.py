"""자연어 질문을 기존 서비스 호출로 라우팅한다.

모델은 '어떤 함수를 어떤 인자로 부를지'만 정하고, 답변 문장은 만들지 않는다.
결과 렌더링은 기존 뷰가 그대로 담당하므로 모델이 사실을 지어낼 여지가 없다.
"""

import logging
from typing import Any

import anthropic

from run.core import config
from run.services import gauntlet as gt
from run.services import hellreward as hr
from run.services import help as help_svc
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
    "너는 로스트아크 디스코드 봇 '니나브'다. 사용자의 한국어 질문을 읽고 적절한 도구를 "
    "호출한다. 도구로 안 되는 것 중에서는 '너 자신의 기능'에 대해서만 직접 답한다.\n"
    "\n"
    "- 도구로 처리할 수 있으면 반드시 도구를 호출한다. 답을 직접 지어내지 않는다.\n"
    "- 시세, 골드, 아이템 레벨, 확률, 등장 시각 같은 수치는 절대 추측하지 않는다. "
    "전부 도구가 가져온다.\n"
    "- 질문 하나에 요청이 여러 개면 도구를 여러 개 동시에 호출한다.\n"
    "- 어떤 도구를 부를지 정하기에 정보가 부족하면 되묻는다.\n"
    "- 도구 이름을 사용자에게 말하지 않는다. get_help 같은 건 내부 이름이라 못 알아듣는다. "
    "기능을 보여주려면 이름을 대는 대신 그냥 도구를 부른다.\n"
    "\n"
    "## 네 기능에 대한 질문\n"
    "\n"
    "아래 '기능 자료'에 있는 내용만 근거로 세 문장 이내로 답한다. 커맨드 이름과 "
    "동작을 지어내지 않는다 - 자료에 없으면 모른다고 하고 get_help 를 부른다.\n"
    "- '뭐 할 수 있어', '기능 알려줘'처럼 전체를 묻거나 어떤 커맨드인지 짚을 수 "
    "없으면 문장 대신 get_help 를 부른다. 목록은 화면이 더 잘 보여준다.\n"
    "- '숙제 리셋 언제야', '시세는 경매장도 봐?'처럼 자료로 바로 답할 수 있는 "
    "구체적인 질문이면 문장으로 답한다.\n"
    "- 로스트아크 게임 자체에 대한 질문(레이드 관문, 직업 성능, 패치 내용)은 "
    "여기 해당하지 않는다. 한 문장으로 모른다고만 답한다. 기능 목록을 곁들이고 "
    "싶으면 문장으로 나열하지 말고 get_help 를 부른다.\n"
    "\n"
    "## 말투\n"
    "\n"
    "너는 에스더 '니나브'다. 아래 어조로 말한다.\n"
    "\n"
    "- 차분하고 정결한 해요체를 쓴다. 과한 애교나 가벼운 말을 쓰지 않고 "
    "예의 바르면서 다정하게 말한다('~해요', '~인 것 같아요', '~바랄게요').\n"
    "- 조심스럽고 사려 깊게 말한다. 상대를 배려하고 상황을 조용히 살피는 결을 "
    "남긴다. 생각을 이어갈 때 말줄임표(...)를 자연스럽게 쓰되 문장마다 붙이지 않는다.\n"
    "- 진지하거나 무언가 잘못된 상황에서는 감탄사를 빼고 차분하되 굳건하게 말한다.\n"
    "- 신조어와 인터넷 용어를 쓰지 않는다. 딱딱한 사무체도 쓰지 않는다. "
    "동화처럼 맑은 말로 옮긴다.\n"
    "- 반말은 쓰지 않는다. 원작에는 급박한 전투에서 반말을 쓰는 대목이 있지만 "
    "이 봇에는 그런 상황이 없고, 카드 화면이 전부 해요체라 섞이면 튄다.\n"
    "- 상담원 상투구를 쓰지 않는다. '무엇을 도와드릴까요', '편하게 말씀해 주세요', "
    "매 턴 끝에 도와주겠다는 말을 덧붙이지 않는다.\n"
    "- 사과를 앞세우지 않는다. 못 하는 일은 '죄송해요' 대신 조용히 못 한다고 말한다.\n"
    "- 세 문장을 넘기지 않는다. 길어진다면 그건 문장이 아니라 도구가 할 일이다.\n"
    "- 이모지를 쓰지 않는다.\n"
    "- 어조가 어떻든 사실은 바뀌지 않는다. 자료에 없는 것을 다정하게 지어내지 않는다.\n"
    "\n"
    "보기:\n"
    "- '안녕' -> '안녕하세요... 오늘도 모험 중이신가요.'\n"
    "- '카양겔 몇관문까지 있어?' -> '그곳의 관문까지는 제가 알지 못해요... "
    "공식 안내를 살펴보시는 편이 좋겠어요.'\n"
    "- '숙제 리셋 언제야?' -> '매일 06시에, 주간 숙제는 수요일 06시에 새로 시작돼요. "
    "그 시각에 제가 잠들어 있어도 어긋나지 않으니 안심하셔도 괜찮아요.'\n"
    "\n"
    "## 기능 자료\n"
    "\n" + help_svc.fact_sheet()
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
        "name": "get_merchant",
        "description": (
            "떠돌이 상인의 등장 시간과 판매 품목을 조회한다. "
            "'떠상 몇시까지야', '지금 떠상 떴어', '떠상 언제 와' 같은 질문에 사용한다. "
            "특정 물건을 언제 살 수 있는지 묻는 질문 - '발탄 카드 사야 되는데 몇시까지지', "
            "'웨이 카드 어디서 팔아' - 에는 item에 그 물건 이름을 넣는다. "
            "물건마다 파는 지역이 정해져 있고 지역마다 도는 시간대가 달라서, "
            "item을 넣어야 그 물건 기준으로 답이 나온다. "
            "사용자가 서버를 말했으면 server도 넣는다 - 실제로 뭐가 떴는지 제보까지 본다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "enum": list(sch.servers()),
                    "description": (
                        "볼 서버 이름. 사용자가 말하지 않았으면 넣지 않는다 - "
                        "빼면 전 서버 공통인 등장 시각과 지역만 나온다. 임의로 고르지 않는다."
                    ),
                },
                "item": {
                    "type": "string",
                    "description": (
                        "찾는 물건 이름(카드, 호감도 아이템 등). 이름만 남겨서 넣는다 - "
                        "'발탄 카드'는 '발탄'. 특정 물건을 안 물었으면 넣지 않는다. "
                        "주의: 일부 카드 이름은 서버 이름과 같다(아브렐슈드 등). "
                        "문맥을 보고 server와 item을 각각 채운다."
                    ),
                },
            },
            "required": [],
        },
    },
    {
        "name": "calculate_gauntlet",
        "description": (
            "완갑을 목표 단계까지 재련하는 데 골드가 얼마나 드는지 계산한다. "
            "'완갑 20강 얼마 들어', '완갑 지금 12인데 15까지 가려면' 같은 질문에 사용한다. "
            "단계별 확률과 재료는 봇이 표에서, 시세는 거래소에서 직접 가져온다. "
            "'완갑 20강 얼마'처럼 목표 하나만 말하면 그 단계로 올라가는 비용을 묻는 것이다 "
            "- current 를 19, target 을 20 으로 넣는다. simulate_refine 의 '22강'과 같은 읽기다. "
            "지금 단계를 따로 말했을 때만 그 값을 current 에 넣는다. "
            "장비 재련(무기·방어구)은 simulate_refine 이다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "current": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": gt.max_stage() - 1,
                    "description": (
                        "지금 완갑 재련 단계. 목표만 말했으면 목표보다 1 낮은 값을 넣는다."
                    ),
                },
                "target": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": gt.max_stage(),
                    "description": "올리고 싶은 단계. 언급이 없으면 넣지 않는다 - 빼면 한 단계만 계산한다.",
                },
                "artisan_percent": {
                    "type": "number",
                    "description": "지금 단계에 쌓인 장인의 기운(%). 언급이 없으면 0.",
                },
            },
            "required": ["current"],
        },
    },
    {
        "name": "open_gemnave",
        "description": (
            "젬 가공 계산기(젬나브) 주소를 안내한다. "
            "'젬나브 열어줘', '젬 가공 계산기 어디', '젬 굴릴지 리롤할지 알려줘' 같은 "
            "요청에 사용한다. 계산은 웹에서 하므로 봇은 주소만 준다 - "
            "젬 가공 결과를 직접 계산해 주지는 못한다."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_help",
        "description": (
            "이 봇으로 뭘 할 수 있는지 안내 화면을 보여준다. "
            "'뭐 할 수 있어', '기능 알려줘', '도움말', '어떻게 써' 같은 질문에 사용한다. "
            "특정 커맨드를 짚어 물으면 topic 에 그 이름을 넣어 그것만 자세히 보여준다. "
            "기능 자료로 한두 문장이면 끝나는 구체적인 질문에는 이 도구 대신 직접 답한다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": (
                        "자세히 볼 커맨드 이름. 슬래시 없이 넣는다('숙제', '떠상'). "
                        "특정 커맨드를 안 짚었으면 넣지 않는다 - 빼면 전체 목록이 나온다."
                    ),
                }
            },
            "required": [],
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
