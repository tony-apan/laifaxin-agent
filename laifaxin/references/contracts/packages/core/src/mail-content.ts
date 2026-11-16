import { Parser } from 'htmlparser2';
import { attUrl, type MailAttachment, type MailDetail } from './mail';

export type MailContentNode =
  | { type: 'text'; text: string }
  | { type: 'image'; src: string; alt: string }
  | { type: 'element'; tag: string; children: MailContentNode[] };
export interface MailContent {
  nodes: MailContentNode[];
  images: string[];
  blockedImages: number;
  truncated: boolean;
}
const tags = new Set(
  'p div span b strong i em u s del br hr blockquote pre code ul ol li table thead tbody tfoot tr td th h1 h2 h3 h4 h5 h6 a'.split(
    ' ',
  ),
);
const drop = new Set(
  'script style iframe object embed svg math form input button textarea select video audio head title template noscript'.split(
    ' ',
  ),
);
export const MAIL_HTML_LIMIT = 1_000_000;
export function mailImageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim().replace(/^\/\//, 'https://');
  // No app credentials, executable data, local paths, or relative URL resolution.
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i.test(raw))
    return raw.length <= MAIL_HTML_LIMIT ? raw : '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: URLs containing controls are never loaded.
  if (!/^https?:\/\/[^\s/@?#\\]+(?:[/?#]|$)/i.test(raw) || /[\u0000-\u001f\u007f\\]/.test(raw))
    return '';
  try {
    return encodeURI(raw).replace(/%25([\da-f]{2})/gi, '%$1');
  } catch {
    return '';
  }
}
const cidKey = (value: string) => {
  try {
    return decodeURIComponent(value).replace(/^cid:/i, '').replace(/^<|>$/g, '');
  } catch {
    return '';
  }
};
function inlineSources(attachments: MailAttachment[] | null) {
  const sources = new Map<string, string>();
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (!attachment || typeof attachment !== 'object') continue;
    const source = mailImageUrl(attUrl(attachment));
    if (!source) continue;
    for (const cid of [attachment.contentId, attachment.cid]) {
      if (typeof cid === 'string' && cidKey(cid)) sources.set(cidKey(cid), source);
    }
  }
  return sources;
}

/** Build a bounded, inert tree. Source attributes/CSS never enter the native renderer. */
export function parseMailContent(
  html: string,
  attachments: MailAttachment[] | null = [],
): MailContent {
  const result: MailContent = {
    nodes: [],
    images: [],
    blockedImages: 0,
    truncated: html.length > MAIL_HTML_LIMIT,
  };
  const inline = inlineSources(attachments);
  const stack: { children: MailContentNode[]; dropped: boolean }[] = [
    { children: result.nodes, dropped: false },
  ];
  let count = 0;
  let imageCount = 0;
  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        const parent = stack[stack.length - 1];
        let dropped = parent.dropped || drop.has(tag);
        if (++count > 4000 || stack.length > 32) {
          result.truncated = true;
          dropped = true;
        }
        let children = parent.children;
        if (!dropped && tag === 'img') {
          if (++imageCount > 80) {
            result.truncated = true;
          } else {
            const raw = attrs.src || '';
            const src = /^cid:/i.test(raw) ? inline.get(cidKey(raw)) || '' : mailImageUrl(raw);
            parent.children.push({ type: 'image', src, alt: (attrs.alt || '').slice(0, 500) });
            if (src) result.images.push(src);
            else result.blockedImages++;
          }
        } else if (!dropped && tags.has(tag)) {
          children = [];
          parent.children.push({ type: 'element', tag: tag === 'a' ? 'span' : tag, children });
        }
        stack.push({ children, dropped });
      },
      ontext(text) {
        const parent = stack[stack.length - 1];
        if (parent.dropped || !text) return;
        if (++count > 4000) {
          result.truncated = true;
          return;
        }
        const last = parent.children[parent.children.length - 1];
        if (last?.type === 'text') last.text += text;
        else parent.children.push({ type: 'text', text });
      },
      onclosetag() {
        if (stack.length > 1) stack.pop();
      },
    },
    { decodeEntities: true },
  );
  parser.end(html.slice(0, MAIL_HTML_LIMIT));
  return result;
}
export const escapeMailHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function serializeMailContent(nodes: MailContentNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return escapeMailHtml(node.text);
      if (node.type === 'image')
        return node.src
          ? `<img src="${escapeMailHtml(node.src)}" alt="${escapeMailHtml(node.alt)}">`
          : '';
      if (node.tag === 'br' || node.tag === 'hr') return `<${node.tag}>`;
      return `<${node.tag}>${serializeMailContent(node.children)}</${node.tag}>`;
    })
    .join('');
}
export function mailContent(mail: Pick<MailDetail, 'html' | 'text' | 'attachments'>) {
  const html = typeof mail.html === 'string' && mail.html !== 'false' ? mail.html : '';
  return html
    ? parseMailContent(html, mail.attachments)
    : parseMailContent(`<pre>${escapeMailHtml(mail.text || '')}</pre>`);
}
