# loa-bot

로스트아크 디스코드 봇. `main.py` 가 진입점이고 명령은 `run/` 에 있다.

## 화면을 만들 때

커맨드 응답 화면은 전부 Components V2(`discord.ui.LayoutView`)다. 뷰를 새로 만들거나
고치기 전에 **`.claude/skills/discord-v2/SKILL.md` 를 먼저 읽는다.** 임베드처럼 보이는
문제, Container 중첩 400 에러, 컴포넌트 40개 상한처럼 실제로 겪은 것만 모아 뒀다.

## 스타일

- **이모지 금지.** 새로 작성/수정하는 코드에는 이모지를 쓰지 않는다. 봇이 보내는 메시지도 포함.
  아이콘이 필요하면 유니코드 이모지(📍🃏 등) 대신 텍스트나 이미 쓰던 기호(`·`, `└`, `-#` 등)를 쓴다.
- **주석은 why 만.** 코드가 이미 말하는 what 은 반복하지 않고, 그렇게 짠 이유·배경·제약만 남긴다.
- 문서와 주석은 한국어.

## 젬 가공 계산기는 다른 저장소로 나갔다

원래 `web/gempago/` 에 있던 젬 가공 계산기는 **젬나브**라는 이름으로 독립했다.

- https://github.com/sehyun04/gemnave
- 로컬: `C:\Users\kshkj\Desktop\sehyun\gemnave`

`git subtree split` 으로 커밋을 그대로 들고 나갔으므로 이 저장소의 히스토리에도
같은 작업이 남아 있다. **여기서는 더 손대지 않는다.** 계산기 관련 요청은 그 저장소에서
하고, 규칙과 배경은 거기 `AGENTS.md` 와 `README.md` 에 있다.

## 원격

원격 푸시는 저장소 주인이 검증한 뒤에 한다. **먼저 푸시하지 말 것.**

## 배포

`main` 에 푸시하면 오라클 서버에 배포된다. 다만 **GitHub 의 push 트리거가 2026-08-25
부터 안 걸린다.** 브랜치를 새로 만들어 밀어도 이벤트 피드에 아무것도 안 잡히고,
`deploy.yml` 의 `on.push` 도 run 을 만들지 않는다. Actions 는 켜져 있고 워크플로도
active 이며 `workflow_dispatch` 는 정상이라 레포 설정 문제가 아니다. 원인은 GitHub
쪽이고 여기서 고칠 수 없다.

그래서 `scripts/githooks/pre-push` 가 main 푸시를 감지해 워크플로를 직접 돌린다.
클론한 뒤 **한 번은 켜야 한다.**

```bash
git config core.hooksPath scripts/githooks
```

훅이 없거나 안 돌았으면 배포도 안 된 것이다. `gh run list --workflow=deploy.yml` 로
run 이 생겼는지 보고, 없으면 `gh workflow run deploy.yml --ref main` 으로 돌린다.
**푸시했다고 배포됐다고 단정하지 마라.**
