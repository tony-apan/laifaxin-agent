#!/usr/bin/env python3
"""双索引机械收敛：两份发现索引只许由本脚本生成，禁止手改。

真源：仓内 laifaxin/ 源码树打包出的两份布局——
  A) 散文件版：site/.well-known/skills/laifaxin/ 树 + site/.well-known/skills/index.json
  B) 压缩包版：site/.well-known/agent-skills/laifaxin-v<版本>.zip + 同目录 index.json
     （与 site/releases/laifaxin-v<版本>.zip 同内容、不同条目前缀）

本脚本做四件事：
  1) 断言三处内容逐字一致：散文件树 == releases zip == well-known zip（按相对路径逐文件比字节）；
  2) 由散文件树实际文件清单重写 V1 索引的 files[]；
  3) 由 well-known zip 的实际 sha256 重写 V2 索引的 url/digest；
  4) --check 模式只断言不写文件：索引与实物有任何漂移即退出码 1。

用法：python3 tools/build-indexes.py <版本号，如 6.1.30> [--check]
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
V1_DIR = SITE / ".well-known" / "skills"
V1_TREE = V1_DIR / "laifaxin"
V1_INDEX = V1_DIR / "index.json"
V2_DIR = SITE / ".well-known" / "agent-skills"
V2_INDEX = V2_DIR / "index.json"


def tree_bytes(base: Path) -> dict:
    out = {}
    for p in sorted(base.rglob("*")):
        if p.is_file():
            out[p.relative_to(base).as_posix()] = p.read_bytes()
    return out


def zip_bytes(path: Path, strip_prefix: str = "") -> dict:
    out = {}
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename
            if name.endswith("/"):
                continue
            if strip_prefix and name.startswith(strip_prefix):
                name = name[len(strip_prefix):]
            out[name] = z.read(info)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: build-indexes.py <版本号> [--check]")
        return 2
    version = sys.argv[1]
    check_only = "--check" in sys.argv[2:]

    rel_zip = SITE / "releases" / f"laifaxin-v{version}.zip"
    wk_zip = V2_DIR / f"laifaxin-v{version}.zip"
    for p in (rel_zip, wk_zip, V1_INDEX, V2_INDEX):
        if not p.exists():
            print(f"FAIL: 缺文件 {p.relative_to(ROOT)}")
            return 1

    tree = tree_bytes(V1_TREE)
    rel = zip_bytes(rel_zip, strip_prefix="../../laifaxin/")
    wk = zip_bytes(wk_zip)
    # feedback.md 是未获批准的草案：只许存在于源码树，不许进任何分发布局
    for label, d in (("散文件树", tree), ("releases zip", rel), ("well-known zip", wk)):
        extra = set(d) - set(rel)
        missing = set(rel) - set(d)
        if "references/feedback.md" in d:
            print(f"FAIL: {label} 含未批准草案 references/feedback.md")
            return 1
        if extra or missing:
            print(f"FAIL: {label} 与 releases zip 条目不一致，多 {sorted(extra)} 缺 {sorted(missing)}")
            return 1
        diff = [k for k in rel if d[k] != rel[k]]
        if diff:
            print(f"FAIL: {label} 与 releases zip 内容不一致: {diff}")
            return 1
    print(f"OK: 三处布局逐字一致（{len(rel)} 个文件）")

    files = sorted(tree.keys())
    v1 = json.loads(V1_INDEX.read_text(encoding="utf-8"))
    v1["skills"][0]["files"] = files

    digest = hashlib.sha256(wk_zip.read_bytes()).hexdigest()
    v2 = json.loads(V2_INDEX.read_text(encoding="utf-8"))
    v2["skills"][0]["url"] = wk_zip.name
    v2["skills"][0]["digest"] = f"sha256:{digest}"

    cur_v1 = json.loads(V1_INDEX.read_text(encoding="utf-8"))
    cur_v2 = json.loads(V2_INDEX.read_text(encoding="utf-8"))
    drift = []
    if cur_v1["skills"][0].get("files") != files:
        drift.append("V1 索引 files[] 与散文件树不一致")
    if cur_v2["skills"][0].get("url") != wk_zip.name or cur_v2["skills"][0].get("digest") != f"sha256:{digest}":
        drift.append("V2 索引 url/digest 与 well-known zip 不一致")

    if drift:
        for d in drift:
            print(f"DRIFT: {d}")
        if check_only:
            return 1
        V1_INDEX.write_text(json.dumps(v1, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        V2_INDEX.write_text(json.dumps(v2, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print("已按实物重写两份索引")
    else:
        print("OK: 两份索引与实物一致，无漂移")
    return 0


if __name__ == "__main__":
    sys.exit(main())
