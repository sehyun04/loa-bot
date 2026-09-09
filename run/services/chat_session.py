"""멘션 대화의 최근 이력을 채널+사람 단위로 들고 있는다.

봇이 "어떤 서버인가요" 하고 되물었을 때 사용자가 "루페온" 한 마디로 답할 수 있어야 한다.
채널마다, 그리고 사람마다 따로 묶는다 - 같은 채널에서 두 명이 동시에 써도 섞이지 않는다.

SQLite 에 둔다. 메모리에만 두면 배포할 때마다 모두의 대화가 한꺼번에 끊기는데,
main 에 푸시할 때마다 컨테이너가 새로 뜨므로 하루에도 여러 번이다. 되물어 놓고
사용자가 답하는 사이에 배포가 끼면 봇이 자기가 뭘 물었는지 모른다.
"""

import json
import logging
import time

from run.core import db

log = logging.getLogger("loabot.chat")

# 한 판 하는 동안은 이어지되 어제 얘기까지 끌고 오지는 않는 길이. 오래된 맥락이
# 남아 있으면 새 질문에 엉뚱한 값(세 시간 전에 말한 서버 같은)이 딸려 들어간다.
TTL_SECONDS = 6 * 3600
MAX_TURNS = 8
_PRUNE_INTERVAL = 3600.0

_last_prune = 0.0


async def history(channel_id: str, user_id: str) -> list[dict]:
    row = await db.aquery_one(
        "SELECT messages, updated_at FROM chat_sessions WHERE channel_id=? AND user_id=?",
        (channel_id, user_id),
    )
    if row is None:
        return []
    if int(time.time()) - row["updated_at"] > TTL_SECONDS:
        await forget(channel_id, user_id)
        return []

    try:
        messages = json.loads(row["messages"])
    except (json.JSONDecodeError, TypeError):
        # 맥락 하나 잃는 게 깨진 이력으로 400 을 맞는 것보다 낫다
        log.warning("이력을 읽지 못해 버림: %s:%s", channel_id, user_id)
        await forget(channel_id, user_id)
        return []
    return messages if isinstance(messages, list) else []


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


async def remember(channel_id: str, user_id: str, user_text: str, assistant_text: str) -> None:
    if not user_text or not assistant_text:
        # 빈 content는 API가 거부한다. 반쪽짜리 턴을 남기느니 이번 턴을 통째로 버린다.
        return

    messages = await history(channel_id, user_id)
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "assistant", "content": assistant_text})

    # 이력을 전부 평문으로 두는 이유: 여기서 앞을 잘라내도 안전하다. tool_use 블록을
    # 그대로 쌓으면 자르는 지점이 tool_result와의 짝을 깨서 API가 400을 낸다.
    messages = messages[-MAX_TURNS * 2 :]

    now = int(time.time())
    await db.aexecute(
        "INSERT INTO chat_sessions (channel_id, user_id, messages, updated_at) "
        "VALUES (?,?,?,?) "
        "ON CONFLICT(channel_id, user_id) DO UPDATE SET "
        "  messages=excluded.messages, updated_at=excluded.updated_at",
        (channel_id, user_id, json.dumps(messages, ensure_ascii=False), now),
    )
    await _maybe_prune(now)


async def forget(channel_id: str, user_id: str) -> None:
    await db.aexecute(
        "DELETE FROM chat_sessions WHERE channel_id=? AND user_id=?", (channel_id, user_id)
    )


async def _maybe_prune(now: int) -> None:
    """만료된 줄을 치운다. 남의 대화를 필요 이상으로 오래 들고 있지 않는다."""
    global _last_prune
    if now - _last_prune < _PRUNE_INTERVAL:
        return
    _last_prune = now
    removed = await db.aexecute("DELETE FROM chat_sessions WHERE updated_at < ?", (now - TTL_SECONDS,))
    if removed:
        log.info("만료된 대화 이력 %d건 정리", removed)
