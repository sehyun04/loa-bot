from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")

DAILY_RESET_HOUR = 6
WEEKLY_RESET_WEEKDAY = 2  # 수요일 (월=0)


def now() -> datetime:
    return datetime.now(KST)


def next_daily_reset(ref: datetime | None = None) -> datetime:
    ref = ref or now()
    reset = ref.replace(hour=DAILY_RESET_HOUR, minute=0, second=0, microsecond=0)
    if ref >= reset:
        reset += timedelta(days=1)
    return reset


def next_weekly_reset(ref: datetime | None = None) -> datetime:
    ref = ref or now()
    reset = ref.replace(hour=DAILY_RESET_HOUR, minute=0, second=0, microsecond=0)
    days_ahead = (WEEKLY_RESET_WEEKDAY - reset.weekday()) % 7
    reset += timedelta(days=days_ahead)
    if ref >= reset:
        reset += timedelta(days=7)
    return reset


def next_reset(period: str, ref: datetime | None = None) -> datetime:
    if period == "weekly":
        return next_weekly_reset(ref)
    return next_daily_reset(ref)


def daily_key(ref: datetime | None = None) -> str:
    """현재 일일 주기의 식별자. 06시 이전은 전날 주기에 속한다."""
    shifted = (ref or now()) - timedelta(hours=DAILY_RESET_HOUR)
    return f"D:{shifted.date().isoformat()}"


def weekly_key(ref: datetime | None = None) -> str:
    """현재 주간 주기의 식별자. 그 주기가 시작된 수요일 날짜를 쓴다."""
    shifted = (ref or now()) - timedelta(hours=DAILY_RESET_HOUR)
    date = shifted.date()
    wednesday = date - timedelta(days=(date.weekday() - WEEKLY_RESET_WEEKDAY) % 7)
    return f"W:{wednesday.isoformat()}"


def period_key(period: str, ref: datetime | None = None) -> str:
    """저장된 진행상황이 현재 주기의 것인지 판정하는 키.

    체크 시점의 키를 저장해두고 읽을 때 현재 키와 비교한다. 스케줄러가
    일괄 초기화하는 방식과 달리, 리셋 시각에 봇이 꺼져 있어도 정확하다.
    """
    return weekly_key(ref) if period == "weekly" else daily_key(ref)


def to_discord_timestamp(dt: datetime, style: str = "R") -> str:
    """디스코드가 각 유저 로컬 타임존으로 렌더링하는 타임스탬프.

    봇이 KST 문자열을 직접 찍으면 해외 유저에게 어긋나므로 이 형식을 쓴다.
    """
    return f"<t:{int(dt.timestamp())}:{style}>"


def format_duration(delta: timedelta) -> str:
    total = int(delta.total_seconds())
    if total < 0:
        total = 0
    hours, remainder = divmod(total, 3600)
    minutes = remainder // 60
    if hours:
        return f"{hours}시간 {minutes}분"
    return f"{minutes}분"
