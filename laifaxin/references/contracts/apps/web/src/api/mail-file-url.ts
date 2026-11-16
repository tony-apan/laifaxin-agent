export const MAIL_FILE_ORIGIN = 'https://files.laifaxin.com';
export const MAIL_FILE_PROXY = '/__mail-files';

/** 保留合法的 URL 转义；文件名中的裸百分号或无效 UTF-8 转义按字面百分号编码。 */
export function normalizeMailFileUrl(source: URL): URL {
  const url = new URL(source.href);
  url.pathname = url.pathname.replace(/(?:%[\da-f]{2})+|%/gi, (escaped) => {
    try {
      decodeURIComponent(escaped);
      return escaped;
    } catch {
      return escaped.replace(/%/g, '%25');
    }
  });
  return url;
}

/** 线上仍使用文件直链；本地开发通过固定文件域名代理读取邮件正文和附件。 */
export function mailFileDownloadUrl(
  url: URL,
  proxy = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'true',
): string {
  const file = normalizeMailFileUrl(url);
  return proxy && file.origin === MAIL_FILE_ORIGIN
    ? `${MAIL_FILE_PROXY}${file.pathname}${file.search}`
    : file.href;
}
