import os
from pathlib import Path

from dotenv import load_dotenv

# BOT_ENV_FILE로 프로필별 .env 교체 가능 (로컬/운영 동시 운용)
_env_file = os.getenv("BOT_ENV_FILE", ".env")
load_dotenv(_env_file, override=False)

BOT_ENV = os.getenv("BOT_ENV", "local")

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
DISCORD_APPLICATION_ID = os.getenv("DISCORD_APPLICATION_ID")
LOG_WEBHOOK_URL = os.getenv("LOG_WEBHOOK_URL")

_owner = os.getenv("OWNER_ID", "").strip()
OWNER_ID = int(_owner) if _owner.isdigit() else None

DEV_GUILD_ID = os.getenv("DISCORD_DEV_GUILD_ID", "").strip() or None

LOSTARK_API_KEY = os.getenv("LOSTARK_API_KEY")

# 실제 한도는 분당 100. 20%를 남기는 이유는 이 한도가 프로세스가 아니라
# API 키 단위이기 때문 — 같은 키로 누가 동시에 요청하면 그만큼 깎인다.
LOA_RATE_LIMIT_PER_MIN = int(os.getenv("LOA_RATE_LIMIT_PER_MIN", "80"))
LOA_MAX_CONCURRENCY = int(os.getenv("LOA_MAX_CONCURRENCY", "8"))
LOA_TIMEOUT_SECONDS = int(os.getenv("LOA_TIMEOUT_SECONDS", "10"))

BASE_DIR = Path(__file__).resolve().parents[2]
RESOURCE_DIR = BASE_DIR / "resources"
DATA_DIR = Path(os.getenv("BOT_DATA_DIR") or (BASE_DIR / "data"))
DB_PATH = DATA_DIR / "loabot.db"


def missing_required() -> list[str]:
    """봇을 아예 띄울 수 없는 값만 반환한다.

    LOSTARK_API_KEY는 여기 넣지 않는다. 키가 없어도 떠상/경매계산/동접은
    동작해야 하고, 로아 API가 필요한 커맨드만 개별적으로 막는 편이 낫다.
    """
    return [name for name, value in (("DISCORD_TOKEN", DISCORD_TOKEN),) if not value]


def has_lostark_api() -> bool:
    return bool(LOSTARK_API_KEY)
