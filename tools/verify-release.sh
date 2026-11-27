#!/usr/bin/env bash
# 发版收尾机器闸：校验某个版本的发布包与全部公布面是否一致。
# 用法：tools/verify-release.sh 6.1.28
# 做四件事：
#   1) 从公网（接入站）下载 zip 与 .sha256，按 .sha256 校验 zip；
#   2) 从 GitHub 镜像再下载一份 zip，确认与接入站同字节；
#   3) 扫描公布面（安装文档、README、接入站首页）里有没有写死的、
#      与真源不一致的 64 位校验码；
#   4) 真装验证（tools/verify-install.sh）：在干净环境实际运行官方一键
#      安装命令全程，装齐且与当版 zip 逐字一致才算过——「装得上」与
#      「包没坏」是两回事，本步专验前者（2026-11-26 根治新增）。
# 任一不过，退出码非 0，不许宣布发布完成（见 RELEASING.md）。
set -u
V="${1:?用法: verify-release.sh <版本号，如 6.1.28>}"
ZIP="laifaxin-v${V}.zip"
SITE="https://agent.laifa.xin/releases/${ZIP}"
MIRROR="https://raw.githubusercontent.com/tony-apan/laifaxin-agent/main/site/releases/${ZIP}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

echo "== 1) 公网包校验 =="
curl -fsSL -o "$TMP/$ZIP" "$SITE" || { echo "FAIL: 接入站 zip 下载失败"; exit 1; }
curl -fsSL -o "$TMP/$ZIP.sha256" "$SITE.sha256" || { echo "FAIL: 接入站 .sha256 下载失败"; exit 1; }
if (cd "$TMP" && sha256sum -c "$ZIP.sha256"); then
  TRUE_HASH="$(cut -d' ' -f1 "$TMP/$ZIP.sha256")"
  echo "真源校验码: $TRUE_HASH"
else
  echo "FAIL: 公网包与 .sha256 对不上"
  exit 1
fi

echo "== 2) 镜像一致性 =="
curl -fsSL -o "$TMP/mirror.zip" "$MIRROR" || { echo "FAIL: 镜像 zip 下载失败"; exit 1; }
if [ "$(sha256sum "$TMP/mirror.zip" | cut -d' ' -f1)" = "$TRUE_HASH" ]; then
  echo "OK: 镜像与接入站同字节"
else
  echo "FAIL: 镜像与接入站不一致"
  FAIL=1
fi

echo "== 2b) V2 索引 digest 与 well-known 包一致性 =="
# 取数走 curl（2026-11-27：EdgeOne 对 Python urllib 的响应会中途截断）；python 只解析本地文件
WK_TMP="$(mktemp -d)"
if curl -fsSL -o "$WK_TMP/v2-index.json" "https://agent.laifa.xin/.well-known/agent-skills/index.json" \
  && python3 - "$V" "$WK_TMP/v2-index.json" << 'PYEOF'
import json, sys
v, path = sys.argv[1], sys.argv[2]
idx = json.load(open(path))["skills"][0]
if idx["url"] != f"laifaxin-v{v}.zip":
    print(f"FAIL: V2 索引指向 {idx['url']}，与待验版本 v{v} 不符"); sys.exit(1)
print(idx["digest"])
PYEOF
then
  :
else
  FAIL=1
fi
V2_DIGEST="$(python3 -c "import json,sys; print(json.load(open('$WK_TMP/v2-index.json'))['skills'][0]['digest'])" 2>/dev/null || true)"
if [ -n "$V2_DIGEST" ] && curl -fsSL -o "$WK_TMP/wk.zip" "https://agent.laifa.xin/.well-known/agent-skills/laifaxin-v$V.zip"; then
  if [ "sha256:$(sha256sum "$WK_TMP/wk.zip" | cut -d' ' -f1)" = "$V2_DIGEST" ]; then
    echo "OK: V2 索引 digest 与 well-known 包一致"
  else
    echo "FAIL: V2 索引 digest 与 well-known 包实际哈希不一致"
    FAIL=1
  fi
else
  echo "FAIL: V2 索引或 well-known 包取不到"
  FAIL=1
fi
rm -rf "$WK_TMP"

echo "== 3) 公布面写死校验码扫描 =="
check_surface() {
  # $1=名称 $2=URL；页面里出现的每个 64 位十六进制串都必须等于真源
  local name="$1" url="$2" found h
  found="$(curl -fsSL "$url" | grep -oE '[a-f0-9]{64}' | sort -u || true)"
  for h in $found; do
    if [ "$h" = "$TRUE_HASH" ]; then
      echo "WARN: $name 写死了校验码（当前与真源一致，但违反单一真源规则，见 RELEASING.md）"
    else
      echo "FAIL: $name 出现不一致的校验码: $h"
      FAIL=1
    fi
  done
  [ -z "$found" ] && echo "OK: $name 未写死校验码"
}
check_surface "安装文档" "https://agent.laifa.xin/doc/skill-setup.md"
check_surface "仓库README" "https://raw.githubusercontent.com/tony-apan/laifaxin-agent/main/README.md"
check_surface "接入站首页" "https://agent.laifa.xin/"

echo "== 4) 真装验证（干净环境跑一键安装全程） =="
if "$(dirname "$0")/verify-install.sh" "$V"; then
  echo "OK: 真装通过"
else
  echo "FAIL: 真装验证未过"
  FAIL=1
fi

if [ "$FAIL" = 0 ]; then
  echo "== 全部通过：v$V 发布面一致 =="
else
  echo "== 有失败项：不许宣布发布完成 =="
  exit 1
fi
