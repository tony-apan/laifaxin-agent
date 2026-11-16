import PostalMime, { type Attachment } from 'postal-mime';
import { mailFileDownloadUrl } from '@/api/mail-file-url';
import { sanitizeEmailHtml } from '@/components/rich-text-editor/reader';

function contentId(value: string): string {
  const id = value.trim().replace(/^cid:/i, '').replace(/^<|>$/g, '');
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function inlineImageType(attachment: Attachment): string | undefined {
  if (/^image\/(?:png|jpeg|gif|webp|bmp|avif)$/i.test(attachment.mimeType))
    return attachment.mimeType;
  if (attachment.mimeType !== 'application/octet-stream' || typeof attachment.content !== 'string')
    return undefined;
  // 部分邮件把 CID 图片标成通用二进制；只按文件头识别位图，不靠扩展名放行任意附件。
  const header = atob(attachment.content.slice(0, 32));
  if (header.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (header.startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  if (header.startsWith('BM')) return 'image/bmp';
  return undefined;
}

/** 内嵌图片来自 EML 本身，不再请求附件地址；普通附件仍使用服务端的附件列表。 */
function inlineImages(html: string, attachments: Attachment[]): string {
  const images = new Map<string, string>();
  for (const attachment of attachments) {
    if (!attachment.contentId || typeof attachment.content !== 'string') continue;
    const mimeType = inlineImageType(attachment);
    if (mimeType) {
      images.set(contentId(attachment.contentId), `data:${mimeType};base64,${attachment.content}`);
    }
  }
  // template 内的图片不会加载；正文在进入阅读器和引用块前先经过同一套 HTML 清洗。
  const template = document.createElement('template');
  template.innerHTML = sanitizeEmailHtml(html);
  for (const image of template.content.querySelectorAll('img[src]')) {
    const src = image.getAttribute('src') ?? '';
    if (!/^cid:/i.test(src)) continue;
    const data = images.get(contentId(src));
    if (data) image.setAttribute('src', data);
  }
  return template.innerHTML;
}

/** 保留原始字节，让 MIME 解析器按每个 part 的字符集和传输编码解码。 */
export async function downloadMailBody(rawUrl: string): Promise<{ html: string; text: string }> {
  const url = new URL(rawUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid EML URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(mailFileDownloadUrl(url), {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`EML download failed (${response.status})`);
    const raw = await response.arrayBuffer();
    if (!raw.byteLength) throw new Error('Empty EML response');
    const email = await PostalMime.parse(raw, {
      attachmentEncoding: 'base64',
      forceRfc822Attachments: true,
    });
    if (!email.headers.length) throw new Error('Invalid EML response');
    const html = inlineImages(email.html || '', email.attachments);
    return { html: html.trim() ? html : '', text: email.text || '' };
  } finally {
    clearTimeout(timer);
  }
}
