#!/usr/bin/env python3
"""Portable Laifaxin Web API client. Python 3.10+, standard library only."""
import argparse
import base64
import email.utils
import getpass
import hashlib
import hmac
import http.client
import json
import mimetypes
import math
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

SKILL = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "https://api.laifaxin.com/api"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
SECRET_KEYS = {"pwd", "pass", "mailpass", "accesskeyid", "bindingticket", "captcha", "authorization", "devicecode"}
MAX_RESPONSE = 32 * 1024 * 1024


class SkillError(Exception):
    def __init__(self, message, *, details=None, uncertain=False):
        super().__init__(message)
        self.details = details
        self.uncertain = uncertain


def secret_key(key):
    normalized = re.sub(r"[_-]", "", key).lower()
    return normalized in SECRET_KEYS or normalized.endswith(("password", "passwd", "passphrase", "secret", "token", "credential", "credentials", "apikey"))


def secrets_in(value):
    if isinstance(value, dict):
        return [secret for key, child in value.items() for secret in
                ([child] if secret_key(key) and isinstance(child, str) else secrets_in(child))]
    if isinstance(value, list):
        return [secret for child in value for secret in secrets_in(child)]
    return []


def redact(value, secrets=()):
    if isinstance(value, dict):
        return {k: "[redacted]" if secret_key(k)
                else redact(v, secrets) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, secrets) for v in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
    return value


def emit(value, secrets=()):
    print(json.dumps(redact(value, secrets), ensure_ascii=False, indent=2))


def load_catalog():
    return json.loads((SKILL / "references/api-catalog.json").read_text(encoding="utf-8"))


def endpoint_spec(endpoint, method="POST"):
    for item in load_catalog()["endpoints"]:
        if item["path"] == endpoint and item["method"] == method:
            return item
    raise SkillError("接口不在随包提供的 Web 契约中；先更新接口目录，不猜测路径。")


def profile_path(name):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", name):
        raise SkillError("配置名称只能包含字母、数字、下划线和短横线。")
    return Path(os.environ.get("LAIFAXIN_CONFIG_DIR", str(Path.home() / ".config/laifaxin-skill"))) / f"{name}.json"


def load_profile(name):
    p = profile_path(name)
    if not p.exists():
        raise SkillError("尚未配置连接。请先运行 configure，再由用户在本机运行 login 或 import-session。")
    if p.is_symlink() or (os.name == "posix" and stat.S_IMODE(p.stat().st_mode) & 0o077):
        raise SkillError("凭据文件必须是本机普通文件，且仅当前用户可读写（权限 600）。")
    config = json.loads(p.read_text(encoding="utf-8"))
    validate_connection(config)
    return config


def save_profile(name, config):
    validate_connection(config)
    p = profile_path(name)
    p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if p.parent.is_symlink() or p.is_symlink():
        raise SkillError("不向符号链接写入凭据。")
    fd, temporary = tempfile.mkstemp(prefix=".session-", dir=p.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(config, file, ensure_ascii=False)
            file.write("\n")
        os.replace(temporary, p)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def web_origin(config):
    if "web_origin" in config:
        return config["web_origin"]
    return f"{urllib.parse.urlsplit(config['base_url']).scheme}://{config['host']}"


def validate_connection(config):
    base = config.get("base_url", "")
    parsed = urllib.parse.urlsplit(base)
    local = parsed.hostname in LOOPBACK_HOSTS
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and local)) or not parsed.hostname:
        raise SkillError("接口地址需要 HTTPS；HTTP 仅用于本机 localhost 测试。")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SkillError("接口地址不能包含凭据、查询参数或片段。")
    if not re.fullmatch(r"[A-Za-z0-9.\-\[\]:]+", config.get("host", "")):
        raise SkillError("host 应是用户登录的 Web 主机名，可含端口，不包含协议和路径。")
    if "web_origin" in config:
        origin = config["web_origin"]
        valid_origins = {f"https://{config['host']}"}
        if urllib.parse.urlsplit("//" + config["host"]).hostname in LOOPBACK_HOSTS:
            valid_origins.add(f"http://{config['host']}")
        if origin not in valid_origins:
            raise SkillError("网页来源需要与 host 匹配，只包含协议和主机（可含端口）；HTTP 仅用于本机。")
    for key in ("token", "org_id"):
        value = config.get(key, "")
        if not isinstance(value, str) or any(c in value for c in "\r\n"):
            raise SkillError("会话字段格式无效。")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def transport(url, payload, headers, method="POST", timeout=30, response_headers=None):
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    handlers = [NoRedirect()]
    if urllib.parse.urlsplit(url).hostname in LOOPBACK_HOSTS:
        handlers.append(urllib.request.ProxyHandler({}))
    try:
        try:
            response = urllib.request.build_opener(*handlers).open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if response_headers is not None:
                response_headers.update({key.lower(): value for key, value in response.headers.items()})
            data, status_code = response.read(MAX_RESPONSE + 1), response.code
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as error:
        raise SkillError("网络请求未能确认结果；写操作可能已到达服务器，请查询结果后再决定是否重试。",
                         details={"code": "network_error"}, uncertain=True) from error
    if len(data) > MAX_RESPONSE:
        raise SkillError("响应超过 32MB，请缩小查询范围。", uncertain=method != "GET")
    return status_code, data


class Client:
    def __init__(self, config, timeout=30):
        validate_connection(config)
        self.config = dict(config)
        self.timeout = timeout

    def prepare(self, endpoint, body, method="POST", authenticated=True):
        spec = endpoint_spec(endpoint, method)
        if not isinstance(body, dict):
            raise SkillError("请求体必须是 JSON 对象。")
        if authenticated and not self.config.get("token"):
            raise SkillError("未登录；请在用户本机完成登录。")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if authenticated:
            if self.config.get("auth_method") == "browser":
                if time.time() >= self.config.get("expires_at", 0):
                    raise SkillError("网页授权已过期，请重新运行 login 完成授权。")
                if self.config.get("org_id") != self.config.get("authorized_workspace"):
                    raise SkillError("此凭据仅允许访问已授权工作区；切换工作区需重新网页授权。")
                headers["Authorization"] = "Bearer " + self.config["token"]
            else:
                headers["accesstoken"] = self.config["token"]
            if self.config.get("org_id"):
                headers["uid"] = self.config["org_id"]
        body = dict(body)
        # Mirror Web: postEnvelope adds host, fetchJson's raw callers own their body.
        inject_host = any(c["transport"] != "fetchJson" for c in spec["calls"])
        if inject_host:
            body["host"] = self.config["host"]
        elif "host" in body:
            body["host"] = self.config["host"]
        if method == "GET" and body:
            raise SkillError("此 GET 接口不接受 JSON 请求体。")
        if endpoint == "/refine/company-list" and "current" in body:
            current = body["current"]
            if type(current) is not int or not 1 <= current <= 10000:
                raise SkillError(f"{endpoint} 的 current 需要是 1–10000 的整数。")
        if "pageSize" in body:
            maximum = 10 if endpoint == "/refine/company-list" else 100
            size = body["pageSize"]
            if type(size) is not int or not 1 <= size <= maximum:
                raise SkillError(f"{endpoint} 的 pageSize 需要是 1–{maximum} 的整数。")
        validate_sensitive_body(endpoint, body)
        url = self.config["base_url"].rstrip("/") + endpoint
        return url, body, headers

    def request(self, endpoint, body, method="POST", authenticated=True):
        url, body, headers = self.prepare(endpoint, body, method, authenticated)
        payload = json.dumps(body, ensure_ascii=False).encode() if method != "GET" else None
        status_code, raw = transport(url, payload, headers, method, self.timeout)
        try:
            envelope = json.loads(raw)
        except (ValueError, UnicodeError):
            raise SkillError(f"接口返回非 JSON 响应（HTTP {status_code}）。",
                             uncertain=method != "GET")
        if not isinstance(envelope, dict):
            raise SkillError("响应不是 Web API 信封。", details=envelope, uncertain=method != "GET")
        secret_values = [self.config.get("token", ""), *secrets_in(body)]
        message = redact(str(envelope.get("message") or "请求失败"), secret_values)
        error_details = redact({"http_status": status_code, "response": envelope}, secret_values)
        if status_code in (401, 403) or (status_code == 203 and envelope.get("success") is False):
            raise SkillError(message, details=error_details)
        if type(envelope.get("success")) is not bool:
            raise SkillError("响应缺少明确的业务成功状态；请读回结果，不要重复提交。",
                             details=error_details, uncertain=method != "GET")
        if not 200 <= status_code < 300 or envelope.get("success") is not True:
            raise SkillError(message, details=error_details,
                             uncertain=status_code >= 500 and method != "GET")
        return envelope


def validate_sensitive_body(endpoint, body):
    if endpoint.startswith("/mails/mails-") and body.get("selectOption") == "all":
        filters = body.get("filter", {})
        if not isinstance(filters, dict) or not any(filters.get(k) for k in ("boxName", "tagsId", "keyword")):
            raise SkillError("邮件全选操作需要明确目录、标签或关键词范围。")
        if not body.get("ids"):
            raise SkillError("邮件全选仍需要当前页非空 ids；后端以 filter 和 owners 决定范围。")
    if endpoint == "/mails/sendmail-add":
        if any(not isinstance(body.get(k), str) or not body[k].strip() for k in ("maid", "sender", "to", "subject", "html")):
            raise SkillError("发送需要 maid、sender、逗号分隔的 to、主题和 HTML 正文。")
        if "data:image/" in body["html"] or "blob:" in body["html"]:
            raise SkillError("正文图片需要先上传成功，并替换为服务端返回的 URL。")
        if not re.sub(r"<[^>]*>|&nbsp;", "", body["html"]).strip() and not re.search(r"<img\b", body["html"], re.I):
            raise SkillError("邮件正文不能为空。")
        if not isinstance(body.get("sendAtOnce"), bool):
            raise SkillError("需要明确 sendAtOnce，区分立即发送和定时发送。")
        if body["sendAtOnce"] is False:
            start = body.get("timeStart")
            now = time.time() * 1000
            if isinstance(start, bool) or not isinstance(start, (int, float)) or not now + 1000 < start <= now + 90 * 86400000:
                raise SkillError("定时发送需要未来 90 天内的毫秒时间戳 timeStart。")


def read_json(filename):
    return json.load(sys.stdin) if filename == "-" else json.loads(Path(filename).read_text(encoding="utf-8"))


def session_config(config, session):
    if not isinstance(session, dict):
        raise SkillError("会话必须是 JSON 对象。")
    # Accept Web auth response or an explicitly exported lfx.auth state.
    session = session.get("state", session.get("data", session))
    if not isinstance(session, dict):
        raise SkillError("会话内容无效。")
    token = session.get("accesstoken", session.get("token"))
    uid = session.get("orgId") or session.get("uid")
    if not isinstance(token, str) or not token.strip() or not isinstance(uid, str) or not uid.strip():
        raise SkillError("会话缺少 accesstoken/token 或 orgId/uid；不能猜测工作区。")
    updated = {k: v for k, v in config.items() if k not in {"auth_method", "authorized_workspace", "expires_at", "pending_authorization"}}
    return {**updated, "token": token, "org_id": uid}


OAUTH_CLIENT = "laifaxin"
OAUTH_PATHS = {"/oauth/device/code", "/oauth/token", "/oauth/device/cancel", "/oauth/revoke"}


def retry_after_seconds(value):
    if not isinstance(value, str):
        return 0
    try:
        seconds = int(value) if value.strip().isdigit() else email.utils.parsedate_to_datetime(value).timestamp() - time.time()
        return max(0, math.ceil(seconds))
    except (ValueError, TypeError, OverflowError):
        return 0


def temporary_authorization_error(error):
    details = error.details if isinstance(error.details, dict) else {}
    return (details.get("code") in {"temporarily_unavailable", "network_error", "rate_limited", "slow_down"}
            or details.get("http_status") == 429 or details.get("http_status", 0) >= 500)


def oauth_request(config, endpoint, body, timeout=30):
    if endpoint not in OAUTH_PATHS:
        raise SkillError("未知的授权接口。")
    payload = urllib.parse.urlencode({**body, "client_id": OAUTH_CLIENT}).encode()
    headers = {}
    status, raw = transport(config["base_url"].rstrip("/") + endpoint, payload,
                            {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
                            timeout=timeout, response_headers=headers)
    details = {"http_status": status, "retry_after": retry_after_seconds(headers.get("retry-after"))}
    if status == 404:
        raise SkillError("此站点尚未部署应用网页授权接口，请联系管理员部署后再连接。")
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        raise SkillError("授权接口未返回有效结果，请在网页核对已授权应用后重新连接。", details=details, uncertain=True)
    if not isinstance(result, dict):
        raise SkillError("授权接口响应无效。", details=details, uncertain=True)
    if not 200 <= status < 300 or "error" in result or result.get("success") is False:
        code = result.get("error") or result.get("code")
        if not code:
            code = "rate_limited" if status == 429 or (status == 200 and result.get("success") is False) else "server_error"
        message = redact(str(result.get("error_description") or result.get("message") or "网页授权失败"), secrets_in(body))
        raise SkillError(message, details={**details, "code": code}, uncertain=status >= 500)
    if endpoint in {"/oauth/revoke", "/oauth/device/cancel"} and result != {}:
        raise SkillError("服务器未明确确认撤销或取消结果，本机凭据已保留，请稍后核对。", uncertain=True)
    return result


def retry_authorization_cleanup(config, endpoint, body, timeout=30):
    # Only cancellation/revocation are idempotent here. Never retry device creation or business writes.
    if endpoint not in {"/oauth/device/cancel", "/oauth/revoke"}:
        raise SkillError("此授权操作不能自动重试。")
    deadline, delay = time.monotonic() + 30, 5
    while True:
        try:
            return oauth_request(config, endpoint, body, min(timeout, max(0.1, deadline - time.monotonic())))
        except SkillError as error:
            if not temporary_authorization_error(error):
                raise
            wait = max(delay, (error.details or {}).get("retry_after", 0))
            if time.monotonic() + wait >= deadline:
                raise
            time.sleep(wait)
            delay = min(delay * 2, 60)


def clear_pending(args, config):
    updated = dict(config)
    updated.pop("pending_authorization", None)
    save_profile(args.profile, updated)
    return updated


def browser_login(args, config):
    pending = config.get("pending_authorization")
    if pending and pending.get("client_id") != OAUTH_CLIENT:
        config = clear_pending(args, config)
        pending = None
        if args.resume:
            raise SkillError("来发信开放服务已升级，请运行 login 重新授权；旧请求不能继续，请在网页撤销旧授权记录。")
    if not args.resume:
        if pending and pending.get("expires_at", 0) > time.time():
            try:
                retry_authorization_cleanup(config, "/oauth/device/cancel", {"device_code": pending["device_code"]}, args.timeout)
            except SkillError as error:
                if not isinstance(error.details, dict) or error.details.get("code") not in {"expired_token", "invalid_grant", "access_denied"}:
                    raise
        result = oauth_request(config, "/oauth/device/code", {"scope": "laifaxin.web"}, args.timeout)
        code, device = result.get("user_code"), result.get("device_code")
        lifetime, interval = result.get("expires_in"), result.get("interval", 5)
        if (not isinstance(code, str) or not re.fullmatch(r"[BCDFGHJKLMNPQRSTVWXZ]{5}-[BCDFGHJKLMNPQRSTVWXZ]{5}", code)
                or not isinstance(device, str) or not re.fullmatch(r"[a-f0-9]{64}", device)
                or type(lifetime) is not int or not 0 < lifetime <= 1800
                or type(interval) is not int or not 1 <= interval <= 60):
            raise SkillError("授权接口返回的凭据或有效期无效。")
        expected_uri = f"{web_origin(config)}/authorize"
        uri = result.get("verification_uri")
        if uri != expected_uri:
            raise SkillError("授权页面与配置的来发信站点不一致，请核对连接设置。")
        url = result.get("verification_uri_complete")
        if url is None:
            url = uri  # Older servers may only supply the manual entry page.
        else:
            try:
                if not isinstance(url, str) or any(char.isspace() or ord(char) < 32 for char in url):
                    raise ValueError()
                parsed = urllib.parse.urlsplit(url)
                if (urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")) != uri
                        or parsed.fragment
                        or urllib.parse.parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True) != {"user_code": [code]}):
                    raise ValueError()
            except ValueError:
                raise SkillError("一键授权链接与配置站点或本次授权码不一致，请重新连接。")
        pending = {"client_id": OAUTH_CLIENT, "device_code": device, "user_code": code, "url": url, "verification_uri": uri,
                   "expires_at": time.time() + lifetime,
                   "interval": interval, "next_poll_at": time.time() + interval}
        config = {**config, "pending_authorization": pending}
        save_profile(args.profile, config)
        emit({"state": "authorization_required", "url": url, "user_code": code, "verification_uri": uri,
              "application": "来发信开放服务",
              "message": "请打开授权链接，核对网页与此处授权码一致，再选择工作区并确认。链接无法使用时，打开 verification_uri 手动输入授权码。"})
        sys.stdout.flush()
        if not args.no_browser:
            import webbrowser
            webbrowser.open(url)
    if not isinstance(pending, dict):
        raise SkillError("没有等待确认的授权请求，请先运行 login。")
    deadline = time.monotonic() + args.wait
    while True:
        if time.time() >= pending["expires_at"]:
            clear_pending(args, config)
            raise SkillError("授权请求已过期，请重新运行 login。")
        delay = max(0, pending["next_poll_at"] - time.time())
        remaining = deadline - time.monotonic()
        if remaining <= delay:
            return {"state": "pending", "url": pending["url"], "user_code": pending["user_code"],
                    "verification_uri": pending.get("verification_uri", f"{web_origin(config)}/authorize"),
                    "retry_in": math.ceil(delay), **pending.get("notice", {}),
                    "message": pending.get("notice", {}).get("message", "仍在等待网页授权。确认后运行 login --resume 继续；尚未连接。")}
        time.sleep(min(delay, max(0, pending["expires_at"] - time.time())))
        if time.time() >= pending["expires_at"]:
            continue
        try:
            result = oauth_request(config, "/oauth/token", {"device_code": pending["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"},
                min(args.timeout, max(0.1, deadline - time.monotonic()), max(0.1, pending["expires_at"] - time.time())))
        except SkillError as error:
            code = error.details.get("code") if isinstance(error.details, dict) else None
            if code in {"authorization_pending", "slow_down", "grant_limit_reached"} or temporary_authorization_error(error):
                if code == "slow_down":
                    pending["interval"] += 5
                if code in {"authorization_pending", "slow_down", "grant_limit_reached"}:
                    pending.pop("backoff", None)
                else:
                    pending["backoff"] = min(60, max(pending["interval"], pending.get("backoff", 0)) * 2)
                wait = max(pending["interval"], pending.get("backoff", 0), (error.details or {}).get("retry_after", 0))
                pending["next_poll_at"] = time.time() + wait
                if code == "authorization_pending":
                    pending.pop("notice", None)
                else:
                    notice = {"error_code": code or "temporarily_unavailable",
                              "message": f"{error}；正在等待重试，尚未连接。可运行 login --resume 继续。"}
                    if code == "grant_limit_reached":
                        notice["manage_url"] = f"{web_origin(config)}/account/authorized-apps"
                        notice["message"] = f"{error}。请在授权所属站点撤销旧授权，释放名额后运行 login --resume 继续；尚未连接。"
                    if pending.get("notice") != notice:
                        emit({"state": "pending", "retry_in": math.ceil(wait), **notice})
                        sys.stdout.flush()
                    pending["notice"] = notice
                save_profile(args.profile, config)
                continue
            if code in {"access_denied", "expired_token", "invalid_grant", "invalid_client", "invalid_scope", "invalid_request", "unsupported_grant_type"}:
                clear_pending(args, config)
            raise
        token, workspace = result.get("access_token"), result.get("workspace_id")
        lifetime = result.get("expires_in")
        # Treat access tokens as opaque header-safe strings, not a particular prefix/length.
        if (not isinstance(token, str) or not re.fullmatch(r"[\x21-\x7e]{1,4096}", token)
                or result.get("token_type") != "Bearer" or result.get("scope") != "laifaxin.web"
                or not isinstance(workspace, str) or not workspace.strip()
                or type(lifetime) is not int or not 0 < lifetime <= 30 * 86400):
            raise SkillError("授权结果缺少有效凭据、工作区或有效期；请在网页检查授权记录。", uncertain=True)
        updated = {**config, "token": token, "org_id": workspace, "auth_method": "browser", "oauth_client_id": OAUTH_CLIENT,
                   "authorized_workspace": workspace, "expires_at": time.time() + lifetime}
        updated.pop("pending_authorization", None)
        # Verify that the business API accepts this grant before reporting connected.
        try:
            Client(updated, args.timeout).request("/account/current", {})
        except SkillError:
            try:
                retry_authorization_cleanup(config, "/oauth/revoke", {"token": token}, args.timeout)
            except SkillError:
                pass
            clear_pending(args, config)
            raise
        save_profile(args.profile, updated)
        return {"success": True, "profile": args.profile, "workspace": workspace,
                "expires_at": updated["expires_at"], "message": "已通过网页授权连接来发信开放服务。"}


def disconnect(args, config):
    if config.get("auth_method") == "browser" and config.get("token"):
        retry_authorization_cleanup(config, "/oauth/revoke", {"token": config["token"]}, args.timeout)
    pending = config.get("pending_authorization")
    if pending and pending.get("expires_at", 0) > time.time():
        try:
            retry_authorization_cleanup(config, "/oauth/device/cancel", {"device_code": pending["device_code"]}, args.timeout)
        except SkillError as error:
            if not isinstance(error.details, dict) or error.details.get("code") not in {"expired_token", "invalid_grant", "access_denied"}:
                raise
    updated = {k: v for k, v in config.items() if k not in {"pending_authorization", "auth_method", "authorized_workspace", "expires_at"}}
    save_profile(args.profile, {**updated, "token": "", "org_id": ""})
    return {"success": True, "message": "已断开连接并清除本机会话；网页授权凭据已撤销。" if config.get("auth_method") == "browser" else "已清除本机会话。"}


def login(args, config):
    if args.method == "browser":
        return browser_login(args, config)
    if not sys.stdin.isatty():
        raise SkillError("登录需要用户在本机交互式终端输入；不要将密码或验证码写入聊天或命令参数。")
    if args.method == "password":
        body = {"username": input("账号：").strip(), "password": getpass.getpass("密码：")}
        endpoint = "/user/login"
    else:
        body = {"email": input("邮箱：").strip().lower()}
        client = Client(config)
        client.request("/user/login/email-captcha", body, authenticated=False)
        body["captcha"] = getpass.getpass("邮箱验证码：").strip()
        endpoint = "/user/login/by-email"
    response = Client(config).request(endpoint, body, authenticated=False)
    updated = session_config(config, response)
    Client(updated).request("/account/current", {})
    save_profile(args.profile, updated)
    return {"success": True, "profile": args.profile, "workspace": updated["org_id"]}


def valid_send_status(data):
    if not isinstance(data, dict) or data.get("status") not in ("", "running", "finished"):
        return False
    values = [data.get(key) for key in ("total", "finished", "success", "failed")]
    if any(type(n) is not int or n < 0 for n in values):
        return False
    total, finished, succeeded, failed = values
    results = data.get("results")
    return (total > 0 and finished == succeeded + failed and finished <= total
            and (data["status"] != "finished" or finished == total)
            and isinstance(results, list) and len(results) == finished
            and all(isinstance(r, dict) and isinstance(r.get("to"), str)
                    and type(r.get("success")) is bool
                    and (r.get("message") is None or isinstance(r["message"], str)) for r in results)
            and sum(r["success"] for r in results) == succeeded)


def wait_send(client, send_id, wait, interval):
    deadline = time.monotonic() + wait
    while True:
        response = client.request("/mails/sendmail-status", {"sendId": send_id})
        data = response.get("data")
        if not valid_send_status(data):
            raise SkillError("发送状态缺失或不完整，不能确认发送成功；保留 sendId，勿重新发送。",
                             details={"sendId": send_id, "response": response}, uncertain=True)
        if data["status"] == "finished":
            return {"success": data["failed"] == 0, "sendId": send_id,
                    "state": "finished", "data": data}
        if time.monotonic() >= deadline:
            return {"success": True, "sendId": send_id, "state": "pending", "data": data}
        time.sleep(min(interval, max(0, deadline - time.monotonic())))


def upload_file(client, filename, kind):
    file = Path(filename)
    size = file.stat().st_size
    if not file.is_file() or size >= 10 * 1024 * 1024:
        raise SkillError("文件必须小于 10MB。")
    extension = file.name.rsplit(".", 1)[-1].lower()
    if extension in {"exe", "bat", "cmd", "com", "scr", "msi", "dll", "sh"}:
        raise SkillError("此文件类型不允许上传。")
    auth = client.request("/file/get-auth", {"type": kind}).get("data")
    required = ("SecurityToken", "AccessKeyId", "AccessKeySecret", "bucket", "region", "dirName", "id", "uid")
    if not isinstance(auth, dict) or any(not isinstance(auth.get(k), str) or not auth[k] for k in required):
        raise SkillError("后端未返回完整上传凭证。")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", auth["bucket"]):
        raise SkillError("上传存储桶格式无效。")
    if any("\n" in auth[k] or "\r" in auth[k] for k in required):
        raise SkillError("上传凭证字段格式无效。")
    if any(".." in auth[k].split("/") for k in ("dirName", "id")):
        raise SkillError("上传路径无效。")
    key = (f"{kind}/{auth['dirName']}/{auth['id']}/{file.name}" if kind == "att" else
           f"{kind}/{auth['dirName']}/{auth['id']}_{int(time.time() * 1000)}.{extension}")
    mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    date = email.utils.formatdate(usegmt=True)
    canonical_headers = f"x-oss-date:{date}\nx-oss-security-token:{auth['SecurityToken']}\n"
    to_sign = f"PUT\n\n{mime}\n{date}\n{canonical_headers}/{auth['bucket']}/{key}"
    signature = base64.b64encode(hmac.new(auth["AccessKeySecret"].encode(), to_sign.encode(), hashlib.sha1).digest()).decode()
    headers = {"Content-Type": mime, "x-oss-date": date, "x-oss-security-token": auth["SecurityToken"],
               "Authorization": f"OSS {auth['AccessKeyId']}:{signature}"}
    if kind == "att":
        headers.update({"Content-Disposition": "attachment", "Cache-Control": "no-cache"})
    origin = f"https://{auth['bucket']}.oss-accelerate.aliyuncs.com"
    encoded = urllib.parse.quote(key, safe="/")
    status_code, raw = transport(origin + "/" + encoded, file.read_bytes(), headers, "PUT", client.timeout)
    if not 200 <= status_code < 300:
        try:
            message = ET.fromstring(raw).findtext("Message") or "文件上传失败"
        except ET.ParseError:
            message = f"文件上传失败（HTTP {status_code}）"
        raise SkillError(redact(message, secrets_in(auth)))
    base = auth.get("webSite") or origin
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SkillError("文件已上传，但下载域名无效，尚未登记；不要将它附加到邮件。")
    result = client.request("/file/save-log", {
        "iid": auth["id"], "id": auth["id"], "name": file.name,
        "url": base.rstrip("/") + "/" + encoded, "filePath": key,
        "bucket": auth["bucket"], "region": auth["region"],
        "filename": f"{auth['id']}.{extension}", "dirName": auth["dirName"],
        "uid": auth["uid"], "fileType": mime, "type": kind, "size": size,
    })
    if (not isinstance(result.get("data"), dict) or not isinstance(result["data"].get("url"), str)
            or not result["data"]["url"].strip()):
        raise SkillError("文件上传后登记结果不完整，不可用于发送。")
    return result


def run(args):
    if args.command == "catalog":
        catalog = load_catalog()
        matches = [e for e in catalog["endpoints"] if args.query.lower() in
                   (e["path"] + " " + " ".join(c["name"] + " " + c["file"] for c in e["calls"])).lower()]
        return {"webVersion": catalog["webVersion"], "count": len(matches), "endpoints": [
            {"path": e["path"], "method": e["method"], "operations": sorted({c["name"] for c in e["calls"]})} for e in matches]}
    if args.command == "describe":
        return endpoint_spec(args.endpoint, args.method)
    if args.command == "source":
        if args.file not in load_catalog()["sources"]:
            raise SkillError("请选择接口描述中的随包契约文件。")
        source = (SKILL / "references/contracts" / args.file).read_text(encoding="utf-8")
        return {"file": args.file, "source": source}
    if args.command == "configure":
        base_url = args.base_url.rstrip("/")
        origin = args.web_origin
        host = args.host if args.host is not None else urllib.parse.urlsplit(origin or base_url).netloc
        config = {"base_url": base_url, "host": host, "token": "", "org_id": ""}
        if origin is not None:
            config["web_origin"] = origin.removesuffix("/")
        p = profile_path(args.profile)
        if p.exists():
            raise SkillError("该连接已存在。请使用新 profile，或先 logout 后由用户移除旧配置。")
        save_profile(args.profile, config)
        return {"success": True, "profile": args.profile, "base_url": base_url, "host": host, "web_origin": web_origin(config)}
    config = load_profile(args.profile)
    client = Client(config, args.timeout)
    if args.command == "login":
        return login(args, config)
    if args.command == "import-session":
        updated = session_config(config, read_json(args.file))
        Client(updated).request("/account/current", {})
        save_profile(args.profile, updated)
        return {"success": True, "profile": args.profile, "workspace": updated["org_id"]}
    if args.command == "logout":
        return disconnect(args, config)
    if args.command == "status":
        return {"profile": args.profile, "base_url": config["base_url"], "host": config["host"],
                "workspace": config.get("org_id"), "account": client.request("/account/current", {}).get("data")}
    if args.command == "workspaces":
        return client.request("/enterprise/my-organies", {})
    if args.command == "workspace":
        if config.get("auth_method") == "browser" and args.uid != config.get("authorized_workspace"):
            raise SkillError("此授权绑定一个工作区。请重新运行 login，并在网页选择目标工作区。")
        rows = client.request("/enterprise/my-organies", {}).get("data")
        item = next((r for r in rows if isinstance(r, dict) and r.get("uid") == args.uid), None) if isinstance(rows, list) else None
        if not item or item.get("status", "ok") != "ok":
            raise SkillError("工作区不存在或当前成员状态不允许使用。")
        updated = {**config, "org_id": args.uid}
        account = Client(updated).request("/account/current", {}).get("data")
        save_profile(args.profile, updated)
        return {"success": True, "workspace": args.uid, "account": account,
                "message": "仅切换本 Skill 工作区，未改网页默认工作区。"}
    if args.command == "request":
        body = read_json(args.body_file) if args.body_file else {}
        url, prepared, headers = client.prepare(args.endpoint, body, args.method)
        if not args.execute:
            return {"dry_run": True, "url": url, "method": args.method,
                    "workspace": config.get("org_id"), "body": prepared}
        return redact(client.request(args.endpoint, body, args.method), secrets_in(body))
    if args.command == "send-status":
        return wait_send(client, args.send_id, args.wait, args.interval)
    if args.command == "upload":
        return upload_file(client, args.file, args.kind)
    raise SkillError("未知命令")


def positive_timeout(value):
    n = float(value)
    if not 0 < n <= 60:
        raise argparse.ArgumentTypeError("值需要大于 0 且不超过 60 秒")
    return n


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--profile", default="default")
    p.add_argument("--timeout", type=positive_timeout, default=30)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog").add_argument("query", nargs="?", default="")
    describe = sub.add_parser("describe")
    describe.add_argument("endpoint")
    describe.add_argument("--method", choices=["POST", "GET"], default="POST")
    sub.add_parser("source").add_argument("file")
    conf = sub.add_parser("configure")
    conf.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"API base URL (default: {DEFAULT_BASE_URL})")
    conf.add_argument("--host", help="Web host, including port if present")
    conf.add_argument("--web-origin", help="Origin of the Web authorization page, including scheme and port")
    auth = sub.add_parser("login")
    auth.add_argument("--method", choices=["browser", "password", "email"], default="browser")
    auth.add_argument("--resume", action="store_true", help="Continue the pending browser authorization")
    auth.add_argument("--no-browser", action="store_true", help="Print the authorization URL without opening a browser")
    auth.add_argument("--wait", type=positive_timeout, default=30)
    sub.add_parser("import-session").add_argument("--file", required=True)
    for name in ("logout", "status", "workspaces"):
        sub.add_parser(name)
    sub.add_parser("workspace").add_argument("uid")
    req = sub.add_parser("request")
    req.add_argument("endpoint")
    req.add_argument("--method", choices=["POST", "GET"], default="POST")
    req.add_argument("--body-file", help="UTF-8 JSON file, or - for stdin")
    req.add_argument("--execute", action="store_true", help="Actually call the API; otherwise preview only")
    poll = sub.add_parser("send-status")
    poll.add_argument("send_id")
    poll.add_argument("--wait", type=positive_timeout, default=30)
    poll.add_argument("--interval", type=positive_timeout, default=2)
    upload = sub.add_parser("upload")
    upload.add_argument("file")
    upload.add_argument("--kind", choices=["store", "att", "img", "avatar", "id"], required=True)
    return p


def main():
    args = parser().parse_args()
    secrets = []
    try:
        if args.command not in {"configure", "catalog", "describe", "source"}:
            secrets.extend(secrets_in(load_profile(args.profile)))
        result = run(args)
        emit(result, secrets)
        return 2 if isinstance(result, dict) and result.get("success") is False else 0
    except SkillError as error:
        emit({"success": False, "message": str(error), "details": error.details,
              "outcome_unknown": error.uncertain}, secrets)
        return 2
    except (OSError, ValueError, KeyError) as error:
        # Do not include raw parse errors: they can contain credential input.
        emit({"success": False, "message": f"本机配置或输入文件无效（{type(error).__name__}）。"})
        return 2
    except KeyboardInterrupt:
        emit({"success": False, "message": "已停止；若写请求已经提交，请先核对其结果。"})
        return 130


if __name__ == "__main__":
    sys.exit(main())
