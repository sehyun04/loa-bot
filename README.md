# loa-bot

로스트아크 디스코드 봇. 캐릭터 스펙 조회, 숙제 체크리스트, 거래소 시세, 떠돌이 상인 알림.

> 이 프로젝트는 스마일게이트 / 로스트아크와 공식적으로 무관한 개인 프로젝트입니다.

## 기능

| 커맨드 | 설명 | 로아 API |
|---|---|---|
| `/스펙 <닉네임>` | 아이템 레벨, 전투력, 각인, 보석, 카드 | 필요 |
| `/원정대 <닉네임>` | 같은 계정 캐릭터 전체 | 필요 |
| `/숙제` | 일일·주간 체크리스트 (버튼) | - |
| `/숙제설정 <닉네임>` | 원정대 전체 등록 + 레벨에 맞는 컨텐츠 자동 선택 | 필요 |
| `/시세 <아이템>` | 거래소 최저가·전일 평균 | 필요 |
| `/경매 <낙찰가> <인원>` | 실부담·분배금·손익분기 계산 | - |
| `/지옥보상 <티어> <층>` | 뜬 보상 상자 중 뭐가 이득인지 비교 | 필요 |
| `/재련 <부위> <단계>` | 단계별 확률·재료를 표에서 꺼내 성공까지 평균 골드, 장기백 비용, 숨결이 이득인지 | 필요 |
| `/스펙업 <닉네임>` | 재련·보석·각인 중 뒤처진 순서로 우선순위 (재련·각인은 골드까지) | 필요 |
| `/떠상 [서버]` | 등장 시간, 나올 수 있는 지역, 제보 | - |
| `/떠상제보` | 상인 위치 공유 | - |
| `/떠상알림` | 등장 N분 전 멘션 알림 | - |
| `/떠상알림해제` | 알림 해제 | - |

숙제는 **매일 06시 / 수요일 06시(KST)** 에 리셋됩니다. 리셋 시각에 봇이 꺼져 있어도 정확하게 반영됩니다.

## 셋업

```bash
git clone <이 저장소>
cd loa-bot

python3.12 -m venv .venv          # discord.py 2.7은 3.12까지 지원합니다
.venv/bin/pip install -r requirements.txt

cp .env.example .env              # 값을 채워주세요
.venv/bin/python main.py
```

### 필요한 키

**Discord 봇 토큰** — [Developer Portal](https://discord.com/developers/applications) 에서 발급.
개발자마다 **각자 테스트용 봇을 따로 만드세요.** 같은 토큰으로 두 명이 동시에 실행하면
Discord 세션이 충돌해서 무한 재연결에 빠집니다.

**로스트아크 API 키** — [developer-lostark.game.onstove.com](https://developer-lostark.game.onstove.com/clients)
에서 스토브 계정으로 로그인 후 클라이언트를 만들면 JWT가 나옵니다. 무료이고 만료가 없습니다.

이 키도 **개발자마다 각자 발급하세요.** 요청 한도(분당 100회)가 키 단위라 하나를 나눠 쓰면
서로의 몫을 깎아먹습니다. 유출 시 폭발 반경도 줄어듭니다.

키가 없어도 봇은 실행됩니다. 로아 API가 필요한 커맨드만 자동으로 비활성화됩니다.

### 봇 초대 (주의)

초대 URL에 **`integration_type=0` 을 반드시 넣으세요.**

```
https://discord.com/oauth2/authorize?client_id=<APP_ID>&permissions=84992&integration_type=0&scope=bot+applications.commands
```

이게 없으면 Discord가 "사용자 앱에 추가" 선택지를 함께 띄웁니다. 그쪽으로 진행하면
**설치 성공 메시지가 뜨는데도 봇이 서버 멤버가 되지 않습니다.** 서버에는 안 보이고
`GET /users/@me/guilds` 로 조회하면 0개가 나오는 상태가 됩니다.

`permissions=84992` = 채널 보기 + 메시지 보내기 + 링크 임베드 + 메시지 기록 읽기.

### 키가 유출됐다면

1. **먼저 무효화하세요.** 로아 키는 개발자 포털에서 클라이언트 삭제 후 재발급,
   Discord 토큰은 Developer Portal에서 Reset Token.
2. git 히스토리 정리는 그다음입니다. 히스토리에서 지워도 GitHub 포크와 캐시에는 남습니다.

로아 API 키는 `eyJ...` 로 시작하는 긴 JWT라 로그나 에러 메시지에 섞여도 눈에 잘 띄지 않습니다.
로그를 공유할 때 주의하세요.

## 구조

```
main.py                    실행 진입점
migrations/                SQL 마이그레이션 (번호순 자동 적용)
resources/
  merchant.json            떠상 스케줄·지역·판매품목
  homework.json            숙제 컨텐츠 정의
  market_presets.json      시세 자동완성 후보
  refine_table.json        재련 단계별 확률·재료 (scripts/fetch_refine_table.py 로 갱신)
run/
  core/     config · bot · db · errors · 
  cogs/     슬래시 커맨드 (얇게 유지)
  services/ 데이터·외부 API
  views/    디스코드 임베드·버튼
  web/      포트폴리오 사이트용 HTTP API
  utils/    KST 시각 계산
```

**게임 컨텐츠는 코드가 아니라 데이터입니다.** 레이드가 추가되면 `resources/homework.json` 만
고치면 됩니다. 코드는 건드릴 필요가 없습니다.

## 웹 API (포트폴리오 위젯)

포트폴리오 사이트 오른쪽 아래 니나브 채팅창이 이 API를 부릅니다. 디스코드 멘션 대화와
**같은 라우터, 같은 도구 핸들러**를 씁니다 — 두 벌로 갈라지면 같은 질문에 다른 답이
나가고, 그때 어느 쪽이 맞는지 판단할 근거가 없어집니다.

봇 프로세스 안에서 같이 뜹니다. 별도 프로세스로 빼면 로스트아크 API의 분당 한도가
키 단위라 두 프로세스가 서로 모르는 채 같은 할당량을 깎습니다.

`WEB_API_KEY` 가 비어 있으면 **아예 뜨지 않습니다.** 봇만 돌리는 개발 환경에서
인증 없는 엔드포인트가 열리는 일이 없어야 합니다.

| | |
|---|---|
| `POST /web/ask` | `{session, message}` → `{reply, cards}` |
| `GET /web/health` | 살아있는지와 허용 도구 목록 |

둘 다 `Authorization: Bearer $WEB_API_KEY` 가 필요합니다.

### 웹에서 뺀 도구

| 도구 | 이유 |
|---|---|
| 떠상 카드 알림 등록·해제·목록 | "누가, 어느 채널에서" 가 필요한데 그 값은 디스코드 메시지에만 있습니다. 웹 방문자에게 임의의 유저 ID를 붙이면 남의 구독을 건드릴 수 있습니다. |
| 지옥 보상 비교 | 상자를 고르는 버튼 화면으로 시작합니다. 조작이 없으면 첫 화면에서 더 나아가지 못합니다. |

라우터에게 넘기는 스키마에서도 뺍니다. 남겨두면 모델이 그걸 고르고, 토큰과 지연을
쓰고 나서 "그건 디스코드에서만 돼요"를 돌려주게 됩니다.

### 로컬에서 띄우기

디스코드에 붙지 않고 HTTP 부분만 돌립니다.

```bash
WEB_API_KEY=localdevkey python scripts/run_web_api.py
curl -X POST http://127.0.0.1:8080/web/ask   -H "Authorization: Bearer localdevkey" -H "content-type: application/json"   -d '{"session":"local","message":"운명의 파괴석 시세"}'
```

### 사이트와 연결

인바운드 포트를 열지 않습니다. `deploy/setup-server.sh` 가 "봇은 아웃바운드만 쓴다"는
전제로 방화벽을 안 여는데, Cloudflare Tunnel 은 그 전제를 깨지 않습니다.

1. Zero Trust > Networks > Tunnels 에서 터널을 만들고 토큰을 `.env` 의 `TUNNEL_TOKEN` 에 넣습니다.
2. Public hostname 을 `http://bot:8080` 으로 걸어둡니다 (compose 네트워크 안의 이름입니다).
3. `docker compose --profile tunnel up -d`

사이트 쪽에는 그 hostname 과 키를 시크릿으로 넣습니다.

```bash
wrangler secret put NINAV_ORIGIN   # https://<터널 호스트명>
wrangler secret put NINAV_KEY      # WEB_API_KEY 와 같은 값
```

비용과 남용은 사이트 앞단의 Worker 가 막습니다 — IP당 분당 6회, 하루 총량 상한.
여기 있는 검사(세션당 분당 20회)는 그게 뚫렸을 때를 위한 두 번째 방어선입니다.

## 배포 (Oracle Cloud)

봇은 오라클 클라우드 무료 인스턴스에서 24시간 돌아갑니다.

| | |
|---|---|
| 위치 | 오사카 (`ap-osaka-1`) |
| 사양 | VM.Standard.E2.1.Micro — 1 OCPU / 1GB (Always Free) |
| OS | Ubuntu 24.04 + swap 1GB |
| 실행 | Docker Compose (`restart: unless-stopped`) |

실사용 메모리는 40MB 정도라 1GB로 충분합니다. 인바운드는 SSH(22)만 열려 있고
봇은 디스코드로 나가는 연결만 씁니다.

### 접속 설정 (한 번만)

**개인키를 주고받지 않습니다.** 각자 자기 키를 만들고 공개키만 등록합니다.
사람마다 서버 계정이 따로 있어서, 누가 무엇을 했는지 로그에서 구분되고
나중에 회수할 때 그 계정만 지우면 됩니다.

1. 키를 만듭니다. **없을 때만** — 이미 있으면 그걸 쓰세요.

   ```bash
   ssh-keygen -t ed25519 -C "<본인 이름>@loa-bot"
   ```

   Windows 는 PowerShell 에서 같은 명령이 그대로 됩니다(OpenSSH 기본 내장).
   Git for Windows 의 Git Bash 를 써도 됩니다.

2. **공개키**(`.pub` 로 끝나는 쪽)를 배포 담당자에게 보냅니다.

   ```bash
   cat ~/.ssh/id_ed25519.pub                       # macOS / Linux / Git Bash
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub # Windows PowerShell
   ```

   `.pub` 가 붙지 않은 파일은 **개인키입니다. 절대 보내지 마세요.**

3. 담당자가 등록했다고 하면 `~/.ssh/config` 에 추가합니다.
   Windows 경로는 `C:\Users\<사용자>\.ssh\config` 이고, 안의 `~` 는 그대로 씁니다.

   ```
   Host loa
       HostName <서버 IP>
       User <본인 계정명>
       IdentityFile ~/.ssh/id_ed25519
   ```

`ssh loa` 로 붙으면 끝입니다. `docker` 와 `sudo` 를 쓸 수 있습니다.

### 배포 — `main` 에 올리면 자동입니다

`main` 브랜치에 푸시하면 GitHub Actions 가 서버에 붙어 `pull` + 재빌드까지 합니다.
**따로 할 일이 없습니다.** 진행 상황은 레포의 Actions 탭에서 볼 수 있고,
컨테이너가 기동 후 15초 안에 죽으면 워크플로가 실패하며 로그를 남깁니다.

문서(`*.md`)만 고친 커밋은 배포를 돌리지 않습니다.

서버만 재기동하고 싶을 땐 Actions 탭에서 `deploy` 워크플로를 **Run workflow** 로
수동 실행하면 됩니다.

동작에 필요한 저장소 시크릿(등록되어 있습니다):

| 시크릿 | 내용 |
|---|---|
| `SSH_PRIVATE_KEY` | 서버 접속용 개인키 |
| `SERVER_HOST` | 인스턴스 공인 IP |

### 수동 배포 (디버깅용)

```bash
# 코드만 바뀐 경우
ssh loa 'cd loa-bot && git pull && docker compose up -d --build'

# 로그 보기
ssh loa 'cd loa-bot && docker compose logs -f'

# 상태 / 재시작 / 중지
ssh loa 'cd loa-bot && docker compose ps'
ssh loa 'cd loa-bot && docker compose restart'
ssh loa 'cd loa-bot && docker compose stop'
```

시크릿(`.env`)을 바꿨다면 서버에도 올려야 합니다. 복호화한 평문을 직접 보내는 대신
암호화본을 커밋하고 서버에서 푸는 쪽이 안전합니다.

```bash
sops -d --input-type dotenv --output-type dotenv .env.prod.enc > /tmp/e && scp /tmp/e loa:~/loa-bot/.env && rm /tmp/e
ssh loa 'cd loa-bot && docker compose up -d'
```

**로컬에서 테스트할 때는 서버 봇과 같은 토큰을 쓰지 마세요.** 세션이 충돌해
양쪽 다 무한 재연결에 빠집니다. 자세한 내용은 [SECRETS.md](SECRETS.md) 를 보세요.

### 인프라 콘솔 (인스턴스가 아예 안 뜰 때)

SSH 로 붙을 수 없는 상황 — 인스턴스가 멈췄거나, 방화벽을 잘못 건드려 22번이 막혔거나 —
은 서버 안이 아니라 오라클 콘솔에서 풀어야 합니다.

[cloud.oracle.com](https://cloud.oracle.com) → 로그인 화면에서 **테넌시는 `goenho0613`**,
아이덴티티 도메인은 **`Default`** 를 씁니다. 계정은 초대 메일로 받은 것을 쓰세요.
홈 리전은 오사카(`ap-osaka-1`) 입니다.

`loa-bot-ops` 그룹에 속한 사람이 할 수 있는 일:

| 할 수 있음 | 못 함 |
|---|---|
| 인스턴스 재시작 · 중지 · 시작 | **기존 인스턴스 삭제** |
| 방화벽(Security List) 수정 | 결제·구독 변경 |
| 시리얼 콘솔 접속 (SSH 죽었을 때 복구용) | 다른 사용자 권한 변경 |
| 새 인스턴스 생성 | |

삭제만 막아둔 이유가 있습니다. 이 인스턴스는 Always Free 인 `VM.Standard.E2.1.Micro`
인데, 한 번 지우면 같은 사양이 그 지역에 남아 있다는 보장이 없습니다. 재고가 없으면
되돌릴 방법이 없습니다.

## 기여

- `main` 직접 푸시 대신 브랜치 + PR을 씁니다. 브랜치 이름은 `feat/`, `fix/`, `chore/` 로 시작합니다.
- 게임 데이터 갱신(`resources/*.json`)은 코드를 몰라도 할 수 있습니다. 부담 없이 PR 주세요.
- **로컬에서 테스트할 때 서버에 배포된 봇과 같은 토큰을 쓰지 마세요.** 세션이 충돌합니다.

## 라이선스

MIT
