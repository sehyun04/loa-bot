"""젬나브 안내 화면 (Components V2).

계산은 웹에서 하고 봇은 문을 열어 주기만 한다. 그래서 화면도 하나뿐이다 -
무엇을 해 주는 도구인지 한 줄, 쓰는 법 두 줄, 여는 버튼 하나.

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
"""

import discord

URL = "https://gemnave.sehyuni.com"


def build_view() -> discord.ui.LayoutView:
    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay(
            "# 젬나브\n"
            "젬 가공에서 **지금 뜬 4개로 굴릴지, 리롤할지** 알려주는 계산기예요."
        ),
        discord.ui.Separator(spacing=discord.SeparatorSpacing.small),
        discord.ui.TextDisplay(
            "`1` 젬 가공 화면을 1920x1080 창모드로 띄우고 화면 공유를 켜요\n"
            "`2` 젬 상태와 뜬 항목 4개는 화면에서 읽어 자동으로 채워져요\n"
            "`3` 목표만 고르면 가공과 리롤 중 어느 쪽이 나은지 확률로 답해요"
        ),
        discord.ui.Separator(spacing=discord.SeparatorSpacing.small),
        discord.ui.TextDisplay(
            "-# 계산도 화면 인식도 전부 브라우저 안에서 끝나요. 화면이 어디로도 올라가지 않아요."
        ),
        discord.ui.ActionRow(discord.ui.Button(label="젬나브 열기", url=URL)),
    ]

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(*body))
    return view
