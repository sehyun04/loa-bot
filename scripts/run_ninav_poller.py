"""폴러만 따로 돌린다. 디스코드에 붙지 않는다.

위젯을 고칠 때 디스코드 봇까지 같이 띄우면 개발용 토큰으로 로그인이 일어나고,
운영 봇과 세션이 부딪히거나 커맨드가 다시 동기화된다. 그럴 이유가 없어서
사이트에 붙는 부분만 떼어 돌린다.

운영에서는 이 파일을 쓰지 않는다 - 봇 프로세스가 run/core/bot.py 에서 같은
코루틴을 얹는다. 로스트아크 API 한도가 키 단위라 한 프로세스여야 한다.

    NINAV_SITE_URL=http://127.0.0.1:8788 python scripts/run_ninav_poller.py
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run.core import config  # noqa: E402


async def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("loabot.web")

    if not config.WEB_API_KEY or not config.NINAV_SITE_URL:
        log.error("WEB_API_KEY 와 NINAV_SITE_URL 이 모두 있어야 합니다.")
        return 1

    from run.services.lostark.client import close_client
    from run.services import llm_router
    from run.web import poller

    try:
        await poller.run()
    except KeyboardInterrupt:
        pass
    finally:
        await close_client()
        await llm_router.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(0)
