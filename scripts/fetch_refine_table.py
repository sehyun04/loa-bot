"""loa-calc(icepeng)의 재련 확률·재료표를 resources/refine_table.json 으로 가져온다.

재련 단계별 성공 확률과 재료 수량은 공식 API에 없다. 인게임 재련 창을 사람이 옮겨
적은 표가 유일한 출처고, 그걸 가장 오래 관리해 온 게 loa.icepeng.com(LoaCalc)이다.
그쪽 원본은 TypeScript 소스라 그대로 못 읽으니, 필요한 객체 리터럴만 파싱해서
JSON 으로 떨군다.

패치로 표가 바뀌면 이 스크립트를 다시 돌린다:
    python scripts/fetch_refine_table.py
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCE = (
    "https://raw.githubusercontent.com/icepeng/loa-calc/main/"
    "src/app/refining/data.ts"
)
OUT = Path(__file__).resolve().parents[1] / "resources" / "refine_table.json"

# 파싱할 최상위 const 들. breathTable 류는 refineData 안에서 스프레드로 참조된다.
_CONST_RE = re.compile(r"^(?:export )?const (\w+)[^=]*=\s*", re.MULTILINE)


class _Parser:
    """data.ts 안의 객체 리터럴만 읽는 최소 파서.

    JSON 파서를 못 쓰는 이유는 세 가지다 - 키에 따옴표가 없고, 값이 `[12, 0.0167]`
    같은 튜플이며, `...breathTable[0.5]` 스프레드가 섞여 있다. 그 셋만 처리한다.
    """

    def __init__(self, text: str, env: dict) -> None:
        self.s = text
        self.i = 0
        self.env = env

    def _ws(self) -> None:
        while self.i < len(self.s):
            if self.s[self.i] in " \t\r\n,":
                self.i += 1
            elif self.s.startswith("//", self.i):
                self.i = self.s.find("\n", self.i) + 1 or len(self.s)
            elif self.s.startswith("/*", self.i):
                self.i = self.s.find("*/", self.i) + 2
            else:
                return

    def value(self):
        self._ws()
        c = self.s[self.i]
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c in "'\"":
            return self.string()
        return self.number()

    def obj(self) -> dict:
        assert self.s[self.i] == "{"
        self.i += 1
        out: dict = {}
        while True:
            self._ws()
            if self.s[self.i] == "}":
                self.i += 1
                return out
            if self.s.startswith("...", self.i):
                self.i += 3
                out.update(self.reference())
                continue
            key = self.key()
            self._ws()
            assert self.s[self.i] == ":", self.s[self.i - 20 : self.i + 20]
            self.i += 1
            out[key] = self.value()

    def arr(self) -> list:
        self.i += 1
        out = []
        while True:
            self._ws()
            if self.s[self.i] == "]":
                self.i += 1
                return out
            out.append(self.value())

    def key(self) -> str:
        self._ws()
        if self.s[self.i] in "'\"":
            return self.string()
        m = re.compile(r"[^\s:]+").match(self.s, self.i)
        self.i = m.end()
        return m.group()

    def string(self) -> str:
        quote = self.s[self.i]
        end = self.s.index(quote, self.i + 1)
        out = self.s[self.i + 1 : end]
        self.i = end + 1
        return out

    def number(self):
        m = re.compile(r"-?\d+(?:\.\d+)?(?:e-?\d+)?").match(self.s, self.i)
        self.i = m.end()
        raw = m.group()
        return float(raw) if ("." in raw or "e" in raw) else int(raw)

    def reference(self) -> dict:
        """`breathTable[0.5]` 처럼 앞서 읽어 둔 const 를 첨자로 꺼내 오는 스프레드.

        원본에는 표에 없는 확률을 참조하는 자리가 있다(예: breathTable[0.2]).
        자바스크립트에서는 undefined 를 펼쳐 아무것도 안 붙는 - 즉 그 단계는
        숨결을 못 쓴다는 뜻이라, 여기서도 빈 dict 로 맞춘다.
        """
        m = re.compile(r"(\w+)\[([^\]]+)\]").match(self.s, self.i)
        self.i = m.end()
        return self.env[m.group(1)].get(m.group(2), {})


def parse(text: str) -> dict:
    env: dict = {}
    for m in _CONST_RE.finditer(text):
        parser = _Parser(text, env)
        parser.i = m.end()
        env[m.group(1)] = parser.value()
    return env["refineData"]


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else SOURCE
    if src.startswith("http"):
        text = urllib.request.urlopen(src).read().decode("utf-8")
    else:
        text = Path(src).read_text(encoding="utf-8")

    data = parse(text.replace("\r\n", "\n"))
    payload = {"source": SOURCE, "data": data}
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    levels = sum(len(v) for t in data.values() for v in t.values())
    print(f"{OUT} <- {src} ({levels} 단계)")


if __name__ == "__main__":
    main()
