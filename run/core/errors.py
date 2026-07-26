class LoaApiError(Exception):
    """로스트아크 API 호출 실패 전반."""


class ApiKeyMissing(LoaApiError):
    pass


class ApiKeyInvalid(LoaApiError):
    pass


class RateLimited(LoaApiError):
    def __init__(self, retry_after: float | None = None) -> None:
        super().__init__("요청 한도를 넘었어요")
        self.retry_after = retry_after


class Maintenance(LoaApiError):
    def __init__(self) -> None:
        super().__init__("로스트아크 API가 점검 중이에요")


class CharacterNotFound(LoaApiError):
    def __init__(self, name: str) -> None:
        super().__init__(f"캐릭터를 찾을 수 없어요: {name}")
        self.name = name
