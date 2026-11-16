import {
  attName,
  attSize,
  attUrl,
  type MailDetail,
  type MailNode,
  type MailRow,
  systemBoxOf,
} from './mail';
import { displayHtmlToText } from './text';

export const mailText = (value: unknown): string => (typeof value === 'string' ? value : '');
export const mailLocationKey = (node: Pick<MailNode, 'maid' | 'parent' | 'boxName'>) =>
  JSON.stringify([node.maid, node.parent, node.boxName]);
export interface MailLocation extends MailNode {
  key: string;
  path: string[];
}
/** Exact parent paths survive nesting, duplicate names and non-English IMAP folders. */
export function mailLocations(nodes: MailNode[]): MailLocation[] {
  const result: MailLocation[] = [];
  const seen = new Set<string>();
  function visit(list: MailNode[], path: string[], depth: number) {
    if (depth > 32) throw new Error('mail.invalidResponse');
    for (const n of list) {
      if (
        !n ||
        !mailText(n.maid) ||
        typeof n.parent !== 'string' ||
        !mailText(n.boxName) ||
        (n.children != null && !Array.isArray(n.children))
      )
        throw new Error('mail.invalidResponse');
      const key = mailLocationKey(n);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...n, key, path });
      if (n.children) visit(n.children, n.parent === '/' ? [] : [...path, n.boxName], depth + 1);
    }
  }
  visit(nodes, [], 0);
  return result;
}
export const defaultMailLocation = (locations: MailLocation[]) =>
  locations.find((n) => n.parent !== '/' && systemBoxOf(n.boxName) === 'inbox') ?? locations[0];

/** The legacy move endpoint changes boxName only. Never guess another account or parent. */
export function mailRestoreInbox(locations: MailLocation[], mail: MailRow): MailLocation {
  const inboxes = locations.filter(
    (n) => n.maid === mail.maid && n.parent !== '/' && systemBoxOf(n.boxName) === 'inbox',
  );
  if (inboxes.length !== 1) throw new Error('mail.restoreInboxUnavailable');
  const inbox = inboxes[0];
  if (typeof mail.parent !== 'string' || inbox.parent !== mail.parent)
    throw new Error('mail.restoreHierarchyUnsupported');
  return inbox;
}

/** Display-only text: never pass this output to RichText/HTML or resolve remote resources. */
export function mobileMailBody(mail: MailDetail): {
  text: string;
  truncated: boolean;
  unavailable: boolean;
} {
  const html = mailText(mail.html);
  const source = html && html !== 'false' ? html : mailText(mail.text);
  const limit = 100_000;
  const text =
    html && html !== 'false' ? displayHtmlToText(source.slice(0, limit)) : source.slice(0, limit);
  return {
    text,
    truncated: source.length > limit,
    unavailable: !text.trim() && !!(source || mailText(mail.downloadUrl)),
  };
}
export function mobileMailAttachments(mail: MailDetail) {
  return (Array.isArray(mail.attachments) ? mail.attachments : [])
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({
      name: mailText(attName(a)),
      url: mailText(attUrl(a)),
      size: Number.isFinite(attSize(a)) && attSize(a) > 0 ? attSize(a) : 0,
    }));
}
