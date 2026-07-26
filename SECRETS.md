# 시크릿 관리 가이드 (SOPS + age)

이 프로젝트의 시크릿(디스코드 봇 토큰, 로스트아크 API 키, 로그 웹훅)은
**SOPS + age**로 암호화해서 관리한다. 평문은 절대 커밋하지 않고,
암호화본(`.env.dev.enc` / `.env.prod.enc`)만 레포에 올린다.

## 왜 이렇게 하나

- 공개 레포 + 협업이라 시크릿이 한 번이라도 커밋되면 즉시 유출된다.
- SOPS는 **공개키로 잠그고(암호화) 개인키로 연다(복호화)**. 팀원끼리는
  공개키(`age1...`)만 주고받으면 되고, 공개키는 유출돼도 무해하다.
  시크릿 평문은 Git·디코·카톡 그 어떤 채널도 지나가지 않는다.
- 특히 로스트아크 API 키는 `eyJ...`로 시작하는 긴 **JWT**라, 실수로 로그나
  에러 메시지에 섞여 들어가도 눈에 안 띈다. 반드시 암호화로 관리한다.

## 파일 구조

| 파일 | 내용 | 커밋? |
|---|---|---|
| `.sops.yaml` | 어떤 파일을 누구 공개키로 암호화할지 규칙 | ✅ |
| `.env.example` | 빈 템플릿 | ✅ |
| `.env.dev.enc` | 개발용 시크릿 (암호화본) | ✅ |
| `.env.prod.enc` | 운영용 시크릿 (암호화본, 배포 시 생성) | ✅ |
| `.env`, `.env.dev`, `.env.prod` | 평문 시크릿 | ❌ **절대 금지** (gitignore됨) |
| `~/.config/sops/age/keys.txt` | 개인키 | ❌ 로컬에만, 공유 금지 |

---

## 처음 셋업 (새 팀원)

```bash
# 1. 도구 설치
brew install sops age            # macOS
# (Linux는 apt/패키지 매니저 또는 GitHub releases)

# 2. 개인 age 키 생성 (한 번만)
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt

# 3. 열쇠 위치를 셸에 등록 (~/.zshrc 또는 ~/.bashrc 에 추가)
echo 'export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"' >> ~/.zshrc
source ~/.zshrc

# 4. 본인 공개키 확인 → 거노(관리자)에게 전달 (디코 DM으로 보내도 안전)
age-keygen -y ~/.config/sops/age/keys.txt
```

5. 거노가 받은 공개키를 `.sops.yaml`에 추가하고 재암호화(`sops updatekeys`)하면,
   그때부터 너도 복호화할 수 있다.

> macOS 주의: `SOPS_AGE_KEY_FILE`을 설정하지 않으면 sops가 개인키를
> `~/Library/Application Support/sops/age/keys.txt`에서만 찾아 복호화가 실패한다.
> 위 3번은 건너뛰지 말 것.

### 윈도우(Windows) 사용자

**설치만 PowerShell에서 하고, 나머지는 Git Bash에서** 하면 위 macOS 가이드와
거의 동일하게 흘러간다. (Git for Windows를 깔면 Git Bash가 함께 설치된다.)

```powershell
# PowerShell 또는 cmd 에서 설치
winget install FiloSottile.age getsops.sops
# winget이 없으면:  scoop install sops age   또는   choco install sops age
```

```bash
# 이후는 Git Bash 에서 (macOS 가이드와 동일, 셸 rc만 ~/.bashrc)
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
echo 'export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"' >> ~/.bashrc
source ~/.bashrc
age-keygen -y ~/.config/sops/age/keys.txt   # 이 공개키를 관리자에게 전달
```

> ⚠️ **복호화는 반드시 Git Bash에서 하라.** PowerShell의 `>` 리다이렉션은 파일을
> UTF-16으로 저장해 `.env`가 깨지고 봇이 읽지 못한다. Git Bash에서
> `sops -d ... .env.dev.enc > .env` 로 하면 UTF-8로 정상 저장된다.
> 굳이 PowerShell을 쓴다면(PowerShell 7+):
> `sops -d --input-type dotenv --output-type dotenv .env.dev.enc | Out-File .env -Encoding utf8NoBOM`

---

## 일상 워크플로우

```bash
# 개발 시작: 암호화본 → 평문 .env 로 풀기
sops -d --input-type dotenv --output-type dotenv .env.dev.enc > .env

# 봇 실행 (기본으로 .env 를 읽는다)
python main.py

# 시크릿 값 수정 (에디터로 열리고, 저장하면 자동 재암호화)
sops --input-type dotenv --output-type dotenv .env.dev.enc

# 또는 .env 를 직접 고친 뒤 재암호화
cp .env .env.dev.enc
sops -e -i --input-type dotenv --output-type dotenv .env.dev.enc
```

> `--input-type dotenv --output-type dotenv`가 매번 붙는 이유: 파일 확장자가
> `.enc`라 sops가 형식을 자동 인식하지 못하기 때문. 귀찮으면 셸 함수로 감싸도 된다.

---

## dev / prod 구분

토큰을 개발용과 운영용으로 나누는 이유:

1. **디스코드 토큰은 동시접속 불가** — 같은 봇 토큰으로 로컬과 서버를 동시에
   켜면 세션 충돌로 무한 재연결된다. 개발용은 각자 **자기 테스트 봇**을 만든다.
2. **사고 격리** — 로컬 실험 중 사고가 나도 개발용 봇/서버에서만 터진다.
3. **로아 API 쿼터** — rate limit 100/min이 **키 단위**라, 개발 호출이 운영
   쿼터를 깎지 않도록 키를 분리한다.

| | `.env.dev.enc` | `.env.prod.enc` |
|---|---|---|
| 봇 토큰 | 각자 테스트 봇 | 실제 서비스 봇 |
| 로아 키 | 각자 발급 | 운영 전용 |
| 개인키 보유 | 개발자 전원 | 배포 담당자만 |

봇은 `BOT_ENV_FILE`로 무엇을 읽을지 고른다 (`run/core/config.py`):

```bash
# 로컬 개발 (기본값 .env)
python main.py

# 서버 운영
sops -d --input-type dotenv --output-type dotenv .env.prod.enc > .env.prod
BOT_ENV_FILE=.env.prod python main.py
```

---

## 운영(prod) 셋업 — 배포할 때

```bash
# 1. 운영 전용 디스코드 봇을 새로 만든다 (개발 봇과 반드시 별도!)
# 2. 운영용 로아 API 키를 발급한다
# 3. 값을 평문 .env.prod 에 채운 뒤 암호화
cp .env.prod .env.prod.enc
sops -e -i --input-type dotenv --output-type dotenv .env.prod.enc
rm .env.prod                     # 평문은 즉시 삭제

# 4. 서버에 개인키 배치 + SOPS_AGE_KEY_FILE 설정
# 5. 실행
sops -d --input-type dotenv --output-type dotenv .env.prod.enc > .env.prod
BOT_ENV_FILE=.env.prod python main.py
```

GitHub Actions로 배포한다면: age **개인키**를 GitHub Secrets(`SOPS_AGE_KEY`)에
저장하고, CI 단계에서 `.env.prod.enc`를 복호화해서 쓴다. (레포엔 암호화본만,
개인키는 Secrets에만.)

---

## 새 팀원 공개키 추가 (거노/관리자)

```bash
# .sops.yaml 의 age 값을 'age1거노...,age1친구1...,age1친구2...' 로 교체 후:
sops updatekeys .env.dev.enc
sops updatekeys .env.prod.enc
```

`updatekeys`는 재암호화 없이 수신자 목록만 갱신한다 (실행하는 사람의 개인키 필요).

---

## 절대 하지 말 것

- 개인키(`keys.txt`) 공유 금지 — Git·디코·카톡 어디에도.
- 평문 `.env` / `.env.dev` / `.env.prod` 커밋 금지 (gitignore돼 있지만 재확인).
- 로아 JWT를 `print`·로그·에러 메시지에 노출 금지.
- 개발용과 운영용 봇 토큰 섞어 쓰기 금지 (동시접속 시 세션 충돌).
