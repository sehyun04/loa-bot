import logging
import sys

from run.core import config
from run.core.bot import LoaBot


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("discord").setLevel(logging.WARNING)


def main() -> int:
    _setup_logging()
    log = logging.getLogger("loabot")

    missing = config.missing_required()
    if missing:
        log.error("필수 환경변수가 없습니다: %s", ", ".join(missing))
        log.error(".env.example을 .env로 복사한 뒤 값을 채워주세요.")
        return 1

    if not config.has_lostark_api():
        log.warning("LOSTARK_API_KEY 미설정 - 캐릭터/시세 조회는 비활성화됩니다.")

    bot = LoaBot()
    try:
        bot.run(config.DISCORD_TOKEN, log_handler=None)
    except KeyboardInterrupt:
        log.info("종료합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
