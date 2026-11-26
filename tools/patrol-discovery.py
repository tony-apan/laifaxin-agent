#!/usr/bin/env python3
"""每日巡检：按发现索引的解析规则探活，不探猜测路径。

  1) 取 /.well-known/skills/index.json，按「索引所在目录 + 技能名 + 相对路径」
     规则逐条取其声明的全部文件，任一非 200 即 FAIL；
  2) 取 /.well-known/agent-skills/index.json，校验其 digest 与所指 zip 的
     实际 sha256 一致，且 zip 可达；
  3) 取当版 releases zip 与 .sha256 并校验（当版号从 V2 索引 url 解析）。

全部通过时只输出一行 OK；有问题逐行输出 FAIL 明细，退出码 1。
用法：python3 tools/patrol-discovery.py
"""
import hashlib
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://agent.laifa.xin"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "laifaxin-patrol/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


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

    def probe(f):
        try:
            status, _ = get(prefix + f)
            return f, status
        except Exception as e:
            return f, getattr(e, "code", str(e))

    with ThreadPoolExecutor(8) as ex:
        for f, code in ex.map(probe, files):
            if code != 200:
                fails.append(f"V1 文件 {f} -> {code}")
    n_ok = len(files) - len(fails)

    version = None
    try:
        _, body = get(f"{BASE}/.well-known/agent-skills/index.json")
        v2 = json.loads(body)["skills"][0]
        version = v2["url"].removeprefix("laifaxin-v").removesuffix(".zip")
        _, zbytes = get(f"{BASE}/.well-known/agent-skills/{v2['url']}")
        actual = "sha256:" + hashlib.sha256(zbytes).hexdigest()
        if actual != v2["digest"]:
            fails.append(f"V2 索引 digest 与 zip 实际哈希不一致（索引 {v2['digest'][:19]}… / 实际 {actual[:19]}…）")
    except Exception as e:
        fails.append(f"V2 索引或 zip 异常: {e}")

    if version:
        try:
            _, sha_body = get(f"{BASE}/releases/laifaxin-v{version}.zip.sha256")
            _, zbytes = get(f"{BASE}/releases/laifaxin-v{version}.zip")
            want = sha_body.decode().split()[0]
            if hashlib.sha256(zbytes).hexdigest() != want:
                fails.append("releases zip 与 .sha256 对不上")
        except Exception as e:
            fails.append(f"releases 包校验异常: {e}")

    if fails:
        for f in fails:
            print(f"FAIL: {f}")
        return 1
    print(f"OK: 巡检全通（V1 索引 {n_ok}/{len(files)} 个文件 200，V2 索引与当版 v{version} 包校验一致）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
