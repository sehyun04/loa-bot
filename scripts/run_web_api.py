"""웹 API만 따로 띄운다. 디스코드에 붙지 않는다.

포트폴리오 위젯을 고칠 때 디스코드 봇까지 같이 띄우면 개발용 토큰으로
로그인이 일어나고, 운영 봇과 세션이 부딪히거나 커맨드가 다시 동기화된다.
그럴 이유가 없어서 HTTP 부분만 떼어 돌린다.

운영에서는 이 파일을 쓰지 않는다 - 봇 프로세스가 run/core/bot.py 에서
같은 앱을 얹는다. 로스트아크 API 한도가 키 단위라 한 프로세스여야 한다.

    python scripts/run_web_api.py
"""

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# 이 스크립트의 목적이 서버를 띄우는 것이라 여기서 켠다.
# 운영은 폴링(run/web/poller.py)으로 돌아가므로 기본값이 꺼짐이다.
os.environ.setdefault("WEB_API_SERVE", "1")

from run.core import config  # noqa: E402


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("loabot.web")

    if not config.WEB_API_KEY:
        log.error("WEB_API_KEY 가 없습니다. .env 에 넣거나 환경변수로 주세요.")
        return 1

    import uvicorn

    from run.web import api

    log.info("웹 API 단독 기동: %s:%s", config.WEB_API_HOST, config.WEB_API_PORT)
    uvicorn.run(
        api.create_app(),
        host=os.getenv("WEB_API_HOST", "127.0.0.1"),
        port=config.WEB_API_PORT,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
