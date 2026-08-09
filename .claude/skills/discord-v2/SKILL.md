---
name: discord-v2
description: 디스코드 커맨드 화면을 만들거나 고칠 때. LayoutView·Container·Section·Separator·Thumbnail 같은 Components V2 로 응답 화면을 짜는 모든 작업에 쓴다. "화면이 임베드처럼 보인다", "항목이 붙어 보인다", "V2 로 예쁘게", "커맨드 추가" 같은 요청이면 코드를 쓰기 전에 읽는다.
---

# Discord Components V2 규칙

이 봇의 응답 화면은 전부 Components V2(`discord.ui.LayoutView`)로 만든다. **V2 에서는
Embed 를 쓸 수 없다** — `Container` 가 그 자리를 대신한다.

아래는 실제로 깨졌거나 지적받은 것만 적었다. 추측은 없다.

## 1. accent_colour 를 주지 마라 — 이게 제일 자주 틀린다

`accent_colour` 가 붙은 `Container` 는 **왼쪽에 색 줄이 생겨서 기존 임베드와 똑같이
보인다.** V2 로 옮겨 놓고도 "이거 임베드 아니냐"는 말을 듣게 된다.

```python
# 나쁨 - 임베드와 구별이 안 된다
discord.ui.Container(text, accent_colour=common.BRAND)

# 좋음 - 테두리만 있는 깔끔한 상자
discord.ui.Container(text)
```

색은 **경고나 오류처럼 톤이 달라야 할 때만** 쓴다(`common.error_view` 참고).
평상시 정보 화면에는 주지 않는다.

## 2. Container 는 중첩할 수 없다

`Container` 안에 `Container` 를 넣으면 400 으로 죽는다.

```
HTTPException: 400 (50035) In components.0.components.N:
Value of field "type" must be one of (1, 9, 10, 12, 13, 14)
```

허용되는 자식은 `ActionRow(1) / Section(9) / TextDisplay(10) / MediaGallery(12) /
File(13) / Separator(14)` 뿐이다. **Container(17) 는 자식이 될 수 없다.**

시각적으로 묶고 싶으면 **LayoutView 에 Container 를 여러 번 add_item** 한다.

```python
view.add_item(discord.ui.Container(*head))   # 머리말
view.add_item(discord.ui.Container(*body))   # 본문
view.add_item(discord.ui.Container(discord.ui.ActionRow(*buttons)))  # 컨트롤
```

## 3. 항목 사이에 얇은 구분선을 넣어라

항목마다 설명이 여러 줄 달리면 그냥 이어 붙였을 때 어디서 한 항목이 끝나는지 안 보인다.

```python
items = []
for i, row in enumerate(rows):
    if items:
        items.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.small))
    items.append(discord.ui.TextDisplay(render(row)))
container = discord.ui.Container(*items)
```

구분선 세기: 항목 사이 `small`, 구역이 바뀔 때 `large`, 그 외 기본값.

## 4. add_item 을 반복하지 말고 리스트로 모아 언팩해라

```python
# 이 레포의 관용구
body: list[discord.ui.Item] = [
    discord.ui.TextDisplay("### 제목"),
    discord.ui.Separator(),
    *rows,
]
view.add_item(discord.ui.Container(*body))
```

## 5. Section 은 accessory 가 필수다

`Section` 은 오른쪽 붙임(accessory) 없이 못 만든다. 이미지가 없을 수 있으면 **분기해서
TextDisplay 만** 넣어라. 안 하면 이미지 없는 경우에 통째로 터진다.

```python
text = discord.ui.TextDisplay(body)
if not image_url:
    return text
return discord.ui.Section(text, accessory=discord.ui.Thumbnail(media=image_url))
```

- `Thumbnail` 은 **항상 오른쪽**에 붙고 **정사각으로 잘린다** — 가로로 긴 이미지는 잘린다.
- `media=` 키워드로 넘겨라. 위치 인자는 버전이 올라갈 때 먼저 깨진다.
- 왼쪽에 작은 아이콘이 필요하면 Thumbnail 이 아니라 **커스텀 이모지를 텍스트에** 넣는다.

## 6. 컴포넌트는 한 메시지에 40개까지다

`Container` / `Separator` / `TextDisplay` 가 **각각 하나씩** 센다. 항목마다 구분선을 넣으면
개수가 빨리 는다. 목록을 뿌리는 화면은 **최대 몇 개까지 나올 수 있는지 세어 보고**, 상한이
없으면 자르거나 묶어라.

참고로 `/스펙업` 은 항목이 가장 많을 때(12개) 33개다.

## 7. 텍스트 서식

| 쓰임 | 문법 |
|---|---|
| 제목(가장 큼) | `# 이름` |
| 부제 | `## 부제` |
| 구역 제목 | `### 구역` |
| 작은 회색 글씨 | `-# 설명` |
| 강조 | `**값**` |
| 순번·코드 | `` `1` `` |

- 조회 결과 화면은 **`# 대상이름`** 을 맨 위에 두는 게 이 레포 관례다(`/스펙업` 참고).
- 부연 설명·출처·단서는 전부 `-#` 로 내린다. 본문과 섞으면 읽는 눈이 흐려진다.
- **이모지는 쓰지 않는다**(루트 `CLAUDE.md`). 기호는 `·` `→` `└` 정도만.

## 8. 3초 안에 응답하거나 defer 해라

시세 조회처럼 외부 API 를 여러 번 부르면 3초를 넘겨 `10062 Unknown interaction` 이 난다.

```python
await interaction.response.defer()
report = await service.work(...)          # 오래 걸리는 일
await interaction.followup.send(view=...)  # defer 했으면 followup
```

`defer()` 를 했으면 그 뒤로는 `response.send_message` 가 아니라 **`followup.send`** 다.

## 9. View 인스턴스는 메인 이벤트 루프에서 만들어라

`LayoutView.__init__` 이 `asyncio.get_running_loop()` 를 잡는다. `asyncio.to_thread`
안에서 만들면 `RuntimeError: no running event loop` 가 난다. **블로킹 I/O 만 스레드로
빼고 View 는 바깥에서** 만든다.

## 10. discord.py 버전을 고정해 둔 이유

`requirements.txt` 는 `discord.py==2.7.1` 로 **고정**돼 있다. 풀지 마라.

V2 API 는 아직 바뀌는 중이라, git 에서 최신을 받게 해두면 **코드를 안 건드려도 빌드만으로
화면이 깨진다.** 실제로 다른 봇에서 `Section.accessory` 가 필수가 되면서 전적 조회가
죽은 적이 있다. 올릴 거면 V2 화면을 **전부** 다시 확인하고 올려라.

## 확인하는 법

봇을 띄우지 않고도 여기까지는 검증된다. 화면을 고쳤으면 최소한 이만큼은 돌려 봐라.

```python
view = build_view(data)
payload = view.to_components()   # 여기서 통과하면 전송도 통과한다

def count(n):
    c = 1
    for k in ("components", "accessory"):
        v = n.get(k)
        if isinstance(v, list):  c += sum(count(x) for x in v)
        elif isinstance(v, dict): c += count(v)
    return c
print(sum(count(c) for c in payload))   # 40 이하인지
```

이미지가 **없는** 대상으로도 한 번 돌려라 — Section 분기가 거기서만 터진다.

**픽셀은 결국 사람이 봐야 안다.** 간격·썸네일 크기·줄바꿈은 위 검증으로 안 잡히니,
"확인했다"고 말하지 말고 배포 후 실제로 쳐 보게 안내해라.
