#!/usr/bin/env python3
"""每日巡检：按发现索引的解析规则探活＋逐文件内容校验，不探猜测路径。

  1) 取 /.well-known/skills/index.json，按「索引所在目录 + 技能名 + 相对路径」
     规则逐条取其声明的全部文件：任一非 200 即 FAIL；取到的每个文件再与
     当版 releases zip 内对应文件逐字比对（sha256），不一致即 FAIL
     （2026-11-26 双旗舰补强：只探状态码不够，内容也要对得上当版包）；
  2) 取 /.well-known/agent-skills/index.json，校验其 digest 与所指 zip 的
     实际 sha256 一致，且该 zip 内容与 releases zip 逐字一致；
  3) 当版 releases zip 与 .sha256 一致性（当版号从 V2 索引 url 解析）。

全部通过时只输出一行 OK；有问题逐行输出 FAIL 明细，退出码 1。
用法：python3 tools/patrol-discovery.py
"""
import hashlib
import io
import json
import subprocess
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor

BASE = "https://agent.laifa.xin"


def get(url, timeout=30):
    # 传输层用 curl：2026-11-27 实测 EdgeOne 对 Python urllib 客户端的响应会在
    # 中途截断（curl/wget/node 均正常），巡检若继续用 urllib 会天天误报。
    last = None
    for attempt in range(3):
        try:
            proc = subprocess.run(
                ["curl", "-sS", "-L", "--max-time", str(timeout),
                 "-A", "laifaxin-patrol/1.2", "-w", "\n__HTTP__%{http_code}", url],
                capture_output=True, timeout=timeout + 10)
            body, _, tail = proc.stdout.rpartition(b"\n__HTTP__")
            status = int(tail.decode().strip())
            if proc.returncode != 0:
                raise RuntimeError(f"curl exit {proc.returncode}: {proc.stderr.decode()[:120]}")
            return status, body
        except Exception as e:
            last = e
            time.sleep(2)
    raise last


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def zip_map(zbytes: bytes, strip_prefix: str = "") -> dict:
    out = {}
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        for info in z.infolist():
            name = info.filename
            if name.endswith("/"):
                continue
            if strip_prefix and name.startswith(strip_prefix):
                name = name[len(strip_prefix):]
            out[name] = sha(z.read(info))
    return out


def main() -> int:
    fails = []
    try:
        _, body = get(f"{BASE}/.well-known/skills/index.json")
        v1 = json.loads(body)
    except Exception as e:
        print(f"FAIL: V1 发现索引取不到: {e}")
        return 1
    skill = v1["skills"][0]
    files = skill["files"]
    prefix = f"{BASE}/.well-known/skills/{skill['name']}/"

    version = None
    rel_map = {}
    try:
        _, body = get(f"{BASE}/.well-known/agent-skills/index.json")
        v2 = json.loads(body)["skills"][0]
        version = v2["url"].removeprefix("laifaxin-v").removesuffix(".zip")
        _, rel_bytes = get(f"{BASE}/releases/laifaxin-v{version}.zip")
        rel_map = zip_map(rel_bytes, strip_prefix="../../laifaxin/")
        _, sha_body = get(f"{BASE}/releases/laifaxin-v{version}.zip.sha256")
        if sha(rel_bytes) != sha_body.decode().split()[0]:
            fails.append("releases zip 与 .sha256 对不上")
        _, wk_bytes = get(f"{BASE}/.well-known/agent-skills/{v2['url']}")
        if "sha256:" + sha(wk_bytes) != v2["digest"]:
            fails.append("V2 索引 digest 与 zip 实际哈希不一致")
        elif zip_map(wk_bytes) != rel_map:
            fails.append("V2 zip 内容与 releases zip 不一致")
    except Exception as e:
        fails.append(f"V2 索引或当版包异常: {e}")

    def probe(f):
        try:
            status, data = get(prefix + f)
            if status != 200:
                return f, f"HTTP {status}"
            if rel_map and sha(data) != rel_map.get(f):
                return f, "内容与当版 zip 不一致"
            return f, None
        except Exception as e:
            return f, str(getattr(e, "code", e))

    bad = 0
    with ThreadPoolExecutor(8) as ex:
        for f, err in ex.map(probe, files):
            if err:
                bad += 1
                fails.append(f"V1 文件 {f}: {err}")

    if fails:
        for f in fails:
            print(f"FAIL: {f}")
        return 1
    print(f"OK: 巡检全通（V1 索引 {len(files)}/{len(files)} 个文件 200 且逐字对齐当版 v{version} 包，V2 索引 digest 与双 zip 内容一致）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
