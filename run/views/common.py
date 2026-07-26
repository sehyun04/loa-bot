import discord

BRAND = discord.Color(0xC8963E)
DANGER = discord.Color(0xD64545)
MUTED = discord.Color(0x6E7681)


def base_embed(title: str, description: str | None = None, **kwargs) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=BRAND, **kwargs)


def error_embed(title: str, description: str) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=DANGER)


def notice_embed(title: str, description: str) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=MUTED)


def api_key_missing_embed() -> discord.Embed:
    return error_embed(
        "로스트아크 API 키가 없어요",
        "이 기능은 공식 API가 필요해요.\n"
        "`.env`의 `LOSTARK_API_KEY`를 채우면 바로 쓸 수 있어요.\n"
        "발급: https://developer-lostark.game.onstove.com/clients",
    )
