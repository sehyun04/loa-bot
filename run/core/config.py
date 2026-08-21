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

# 관리자는 여러 명일 수 있다. 예전 단일 OWNER_ID 도 계속 읽어준다.
_owners = os.getenv("OWNER_IDS") or os.getenv("OWNER_ID", "")
OWNER_IDS = frozenset(
    int(x) for x in _owners.replace(" ", "").split(",") if x.isdigit()
)


def is_owner(user_id: int | str) -> bool:
    return int(user_id) in OWNER_IDS

DEV_GUILD_ID = os.getenv("DISCORD_DEV_GUILD_ID", "").strip() or None

LOSTARK_API_KEY = os.getenv("LOSTARK_API_KEY")

# 실제 한도는 분당 100. 20%를 남기는 이유는 이 한도가 프로세스가 아니라
# API 키 단위이기 때문 — 같은 키로 누가 동시에 요청하면 그만큼 깎인다.
LOA_RATE_LIMIT_PER_MIN = int(os.getenv("LOA_RATE_LIMIT_PER_MIN", "80"))
LOA_MAX_CONCURRENCY = int(os.getenv("LOA_MAX_CONCURRENCY", "8"))
LOA_TIMEOUT_SECONDS = int(os.getenv("LOA_TIMEOUT_SECONDS", "10"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
# 라우팅 7개 케이스에서 opus-5와 동일하게 전부 맞았고 더 싸고 빨라서 sonnet-5를 쓴다.
# haiku-4-5 로는 못 바꾼다 - effort를 거부하고 프롬프트 캐시 최소 길이(4096토큰)도
# 못 넘겨서 캐시가 안 걸린다.
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")

# 포트폴리오 사이트의 니나브 위젯이 쓰는 HTTP API.
# 키가 비어 있으면 서버를 아예 띄우지 않는다 - 봇만 돌리는 개발 환경에서
# 포트가 점유되거나 인증 없는 엔드포인트가 열리는 일이 없어야 한다.
WEB_API_KEY = os.getenv("WEB_API_KEY", "").strip() or None
# 컨테이너 밖으로 나가는 건 터널뿐이라 0.0.0.0 이어야 한다.
WEB_API_HOST = os.getenv("WEB_API_HOST", "0.0.0.0")
WEB_API_PORT = int(os.getenv("WEB_API_PORT", "8080"))

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
