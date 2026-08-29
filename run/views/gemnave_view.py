"""젬나브 안내 화면 (Components V2).

계산은 웹에서 한다. 봇은 문만 열어 주므로 화면도 이름과 버튼뿐이다.

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
"""

import discord

URL = "https://gemnave.sehyuni.com"


def build_view() -> discord.ui.LayoutView:
    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay("# 젬나브\n젬 가공 도우미"),
        discord.ui.ActionRow(discord.ui.Button(label="열기", url=URL)),
    ]

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(*body))
    return view
