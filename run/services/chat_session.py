"""멘션 대화의 최근 이력을 채널+사람 단위로 잠깐 들고 있는다.

봇이 "어떤 서버인가요" 하고 되물었을 때 사용자가 "루페온" 한 마디로 답할 수 있어야 한다.
채널마다, 그리고 사람마다 따로 묶는다 - 같은 채널에서 두 명이 동시에 써도 섞이지 않는다.

봇은 단일 프로세스라 메모리에 두면 충분하다. 재시작하면 사라지지만 몇 분짜리
대화 맥락이라 잃어도 무해하다.
"""

import time
from collections import OrderedDict

TTL_SECONDS = 900.0  # 15분 넘게 조용하면 다른 얘기로 본다
MAX_TURNS = 6
MAX_SESSIONS = 500

# "채널:사람" -> (마지막 사용 시각, 메시지 목록)
_sessions: OrderedDict[str, tuple[float, list[dict]]] = OrderedDict()


def _key(channel_id: str, user_id: str) -> str:
    return f"{channel_id}:{user_id}"


def history(channel_id: str, user_id: str) -> list[dict]:
    key = _key(channel_id, user_id)
    entry = _sessions.get(key)
    if entry is None:
        return []

    touched_at, messages = entry
    if time.monotonic() - touched_at > TTL_SECONDS:
        del _sessions[key]
        return []
    return list(messages)


def summarize_calls(calls: list[tuple[str, dict]]) -> str:
    """도구 호출을 이력에 남길 한 줄로 만든다.

    호출 문법을 그대로 쓰지 않는다. assistant 턴에 남은 문자열은 모델에게 "이렇게
    답해도 된다"는 예시로 읽히는데, 하필 그 모양이 도구 호출을 평문으로 흘리는
    실패 모드와 같다. 고치려는 실패를 이력으로 다시 가르칠 이유가 없다.
    """
    done = []
    for name, args in calls:
        pairs = ", ".join(f"{k}={v}" for k, v in args.items())
        done.append(f"{name} 실행 - {pairs}" if pairs else f"{name} 실행")
    return " / ".join(done)


def remember(channel_id: str, user_id: str, user_text: str, assistant_text: str) -> None:
    if not user_text or not assistant_text:
        # 빈 content는 API가 거부한다. 반쪽짜리 턴을 남기느니 이번 턴을 통째로 버린다.
        return

    messages = history(channel_id, user_id)
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "assistant", "content": assistant_text})

    # 이력을 전부 평문으로 두는 이유: 여기서 앞을 잘라내도 안전하다. tool_use 블록을
    # 그대로 쌓으면 자르는 지점이 tool_result와의 짝을 깨서 API가 400을 낸다.
    key = _key(channel_id, user_id)
    _sessions[key] = (time.monotonic(), messages[-MAX_TURNS * 2 :])
    _sessions.move_to_end(key)
    if len(_sessions) > MAX_SESSIONS:
        _sessions.popitem(last=False)


def forget(channel_id: str, user_id: str) -> None:
    _sessions.pop(_key(channel_id, user_id), None)
