#!/usr/bin/env bash
# 真装验证：在干净环境实际运行官方一键安装命令全程，装齐且与当版 zip 逐字一致才算过。
# 用法：tools/verify-install.sh <版本号，如 6.1.30>
# 断言：
#   1) npx skills add https://agent.laifa.xin -g -y 在隔离 HOME 下退出码 0；
#   2) 装到的文件数 == 发现索引声明数 == 当版 releases zip 文件数；
#   3) 装到的每个文件与当版 zip 内对应文件逐字一致（即装到的就是这一版）。
# 结果追加记入 docs/install-verifications.log（发版留痕，随下一次推送入库）。
set -u
V="${1:?用法: verify-install.sh <版本号，如 6.1.30>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/docs/install-verifications.log"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$(dirname "$LOG")"
STAMP="$(date '+%Y-%m-%d %H:%M %Z')"
record() { echo "$STAMP v$V $1" >> "$LOG"; echo "$1"; }

curl -fsSL -o "$TMP/rel.zip" "https://agent.laifa.xin/releases/laifaxin-v${V}.zip" \
  || { record "FAIL: 当版 zip 下载失败"; exit 1; }

RESULT="$(python3 - "$TMP" "$V" << 'PYEOF'
import json, subprocess, sys, urllib.request, zipfile, os
tmp, v = sys.argv[1], sys.argv[2]
with urllib.request.urlopen("https://agent.laifa.xin/.well-known/skills/index.json", timeout=30) as r:
    declared = json.load(r)["skills"][0]["files"]
zipmap = {}
with zipfile.ZipFile(os.path.join(tmp, "rel.zip")) as z:
    for info in z.infolist():
        name = info.filename
        if name.endswith("/"):
            continue
        if name.startswith("../../laifaxin/"):
            name = name[len("../../laifaxin/"):]
        zipmap[name] = z.read(info)
home = os.path.join(tmp, "home")
os.makedirs(home)
env = dict(os.environ, HOME=home)
proc = subprocess.run(["npx", "-y", "skills", "add", "https://agent.laifa.xin", "-g", "-y"],
                      capture_output=True, text=True, env=env, timeout=600)
import glob
cli_ver = "unknown"
for pj in glob.glob(os.path.join(home, ".npm", "_npx", "*", "node_modules", "skills", "package.json")):
    try:
        cli_ver = json.load(open(pj)).get("version", "unknown")
    except Exception:
        pass
if proc.returncode != 0:
    print(f"FAIL: 一键安装退出码 {proc.returncode}（skills CLI {cli_ver}，索引 https://agent.laifa.xin/.well-known/skills/index.json）: " + (proc.stdout + proc.stderr)[-300:].replace("\n", " "))
    sys.exit(0)
base = os.path.join(home, ".agents", "skills", "laifaxin")
installed = {}
for dp, _dn, fn in os.walk(base):
    for x in fn:
        p = os.path.join(dp, x)
        with open(p, "rb") as f:
            installed[os.path.relpath(p, base).replace(os.sep, "/")] = f.read()
if len(installed) != len(declared) or len(installed) != len(zipmap):
    print(f"FAIL: 文件数不一致 装到 {len(installed)} / 索引声明 {len(declared)} / zip {len(zipmap)}")
    sys.exit(0)
diff = [k for k in zipmap if installed.get(k) != zipmap[k]] + [k for k in installed if k not in zipmap]
if diff:
    print(f"FAIL: 装到的内容与当版 zip 不一致: {diff[:5]}（skills CLI {cli_ver}，索引 https://agent.laifa.xin/.well-known/skills/index.json）")
    sys.exit(0)
print(f"PASS: 一键安装全程跑通，装齐 {len(installed)} 个文件且与 v{v} zip 逐字一致（skills CLI {cli_ver}，索引 https://agent.laifa.xin/.well-known/skills/index.json，装入 ~/.agents/skills/laifaxin）")
PYEOF
)"
record "$RESULT"
case "$RESULT" in PASS*) exit 0 ;; *) exit 1 ;; esac
