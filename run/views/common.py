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


def _notice_view(title: str, description: str, colour: discord.Colour) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(f"## {title}\n{description}"),
        accent_colour=colour,
    ))
    return view


def base_view(title: str, description: str) -> discord.ui.LayoutView:
    return _notice_view(title, description, BRAND)


def error_view(title: str, description: str) -> discord.ui.LayoutView:
    return _notice_view(title, description, DANGER)


def notice_view(title: str, description: str) -> discord.ui.LayoutView:
    return _notice_view(title, description, MUTED)


def api_key_missing_embed() -> discord.Embed:
    return error_embed(
        "로스트아크 API 키가 없어요",
        "이 기능은 공식 API가 필요해요.\n"
        "`.env`의 `LOSTARK_API_KEY`를 채우면 바로 쓸 수 있어요.\n"
        "발급: https://developer-lostark.game.onstove.com/clients",
    )
