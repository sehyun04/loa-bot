"""기능 안내 화면 (Components V2).

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
커맨드가 15개라 한 줄씩 컴포넌트로 쪼개면 40개 상한에 닿는다. 구역 하나를
TextDisplay 하나로 묶어 열몇 개로 끝낸다.
"""

import discord

from run.services import help as help_svc


def _line(command: dict) -> str:
    return f"`{command['usage']}`\n-# {command['summary']}"


def build_overview() -> discord.ui.LayoutView:
    bot = help_svc.bot_facts()
    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay(f"# {bot['name']}\n{bot['tagline']}"),
        discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
    ]

    groups = help_svc.grouped()
    for idx, (group, rows) in enumerate(groups):
        block = f"### {group}\n" + "\n".join(_line(c) for c in rows)
        body.append(discord.ui.TextDisplay(block))
        if idx < len(groups) - 1:
            body.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.small))

    body.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
    body.append(discord.ui.TextDisplay("-# 나를 멘션하고 말로 물어봐도 돼"))

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(*body))
    return view


def build_topic(command: dict) -> discord.ui.LayoutView:
    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay(f"# /{command['name']}\n{command['summary']}"),
        discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
        discord.ui.TextDisplay(f"### 쓰는 법\n`{command['usage']}`"),
    ]

    if command["notes"]:
        body.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.small))
        notes = "\n".join(f"- {n}" for n in command["notes"])
        body.append(discord.ui.TextDisplay(f"### 알아두면 좋은 것\n{notes}"))

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(*body))
    return view
