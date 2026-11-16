import {
  attName,
  attSize,
  attUrl,
  isDraftsBox,
  type MailAttachment,
  type MailDetail,
  type MailRow,
} from './mail';
import { isValidAddress, splitAddresses } from './mail-address';
import { normalizeEditorHtml } from './mail-editor';
import { mailText } from './mail-mobile';
import { displayHtmlToText } from './text';

export const DRAFT_BODY_LIMIT = 50_000;
export { normalizeEditorHtml } from './mail-editor';

export function nativeDraftBody(html: string) {
  const start = html.search(/<blockquote(?:\s[^>]*)?>/i);
  const quoted = start >= 0 && /<\/blockquote>\s*$/i.test(html);
  const prefix = quoted ? html.slice(0, start) : html;
  const editable = normalizeEditorHtml(prefix);
  if (editable !== null && draftBodyEditor(prefix).text.length <= DRAFT_BODY_LIMIT) {
    return {
      text: draftBodyEditor(prefix).text,
      html: editable,
      quote: quoted ? html.slice(start) : '',
    };
  }
  // Never round-trip unsupported Web HTML through the native editor's lossy importer.
  return {
    text: '',
    html: '<p></p>',
    quote: `<blockquote data-lfx-quote="1">${html}</blockquote>`,
  };
}
export interface MailDraftAttachment {
  name: string;
  size: number;
  url: string;
}

/** Normalize the received/sent/Web shapes without deduplicating equal filenames. */
export function draftAttachments(
  attachments: MailAttachment[] | undefined,
  forForward = false,
): MailDraftAttachment[] {
  const unavailable = forForward
    ? 'mail.forwardAttachmentsUnavailable'
    : 'mail.draftAttachmentsUnavailable';
  if (attachments == null) return [];
  if (!Array.isArray(attachments)) throw new Error(unavailable);
  return attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object') throw new Error(unavailable);
    const name = attName(attachment),
      size = attSize(attachment),
      url = attUrl(attachment);
    if (
      typeof name !== 'string' ||
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 0 ||
      typeof url !== 'string'
    )
      throw new Error(unavailable);
    // Existing drafts retain their raw server attachments on updates. New forwards
    // must have every original reference available; never silently save a partial set.
    // The API returns unescaped spaces in object-storage paths. Preserve the
    // reference exactly; reject missing hosts and control characters instead.
    if (
      forForward &&
      (!name.trim() ||
        !/^https?:\/\/[^\s/?#]+(?:[/?#][^\r\n\t]*)?$/i.test(url) ||
        [...url].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    )
      throw new Error(unavailable);
    return { name, size, url };
  });
}

export interface MailDraftFields {
  id?: string;
  replyId?: string;
  forwardId?: string;
  attachments?: MailDraftAttachment[];
  /** Preserved library references; edited through Web only. */
  attIds?: string[];
  maid: string;
  sender: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
}
export const isOrdinaryDraft = (mail: MailRow) =>
  isDraftsBox(mail.boxName ?? '') && mail.status === 1 && !(mail.timeStart && mail.timeStart > 0);

/** Editable fields plus an attachment snapshot for display and conflict/readback checks. */
export function draftFields(mail: MailDetail): MailDraftFields {
  if (
    mail.attIds != null &&
    (!Array.isArray(mail.attIds) || mail.attIds.some((id) => typeof id !== 'string'))
  )
    throw new Error('mail.draftAttachmentsUnavailable');
  return {
    attIds: [...(mail.attIds ?? [])],
    id: mail._id,
    attachments: draftAttachments(mail.attachments),
    ...(mail.replyId ? { replyId: mail.replyId } : {}),
    ...(mail.forwardId ? { forwardId: mail.forwardId } : {}),
    maid: mailText(mail.maid),
    sender: mailText(mail.sender),
    to: mailText(mail.to),
    cc: mailText(mail.cc),
    bcc: mailText(mail.bcc),
    subject: mailText(mail.subject),
    html: mailText(mail.html),
  };
}
export const draftContentKey = (d: MailDraftFields) =>
  JSON.stringify([
    d.maid,
    d.sender,
    d.to,
    d.cc,
    d.bcc,
    d.subject,
    d.html,
    d.replyId || '',
    d.forwardId || '',
    d.attachments ?? [],
    d.attIds ?? [],
  ]);

export const draftTextToHtml = (text: string) =>
  `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n?/g, '\n').replace(/\n/g, '<br>')}</p>`;

/** A reversible subset, not an HTML-to-text editor. Rich content stays byte-for-byte intact. */
export function draftBodyEditor(html: string): { text: string; editable: boolean } {
  // Enter in the Web editor creates adjacent plain paragraphs. Preserve their
  // paragraph breaks while leaving all styled/nested markup read-only.
  const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)];
  if (paragraphs.length > 1 && paragraphs.map((p) => p[0]).join('') === html) {
    const parts = paragraphs.map((p) => draftBodyEditor(p[1]));
    const text = parts.map((p) => p.text).join('\n\n');
    if (parts.every((p) => p.editable) && text.length <= DRAFT_BODY_LIMIT)
      return { text, editable: true };
  }
  // Web may unwrap a simple paragraph while sanitizing it. Both shapes are editable;
  // preserve the loaded bytes until the user actually changes the text.
  const content = html.match(/^<p>([\s\S]*)<\/p>$/)?.[1] ?? html;
  if (!/<(?!br\s*\/?\s*>)[^>]*>/i.test(content)) {
    const text = content
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const canonical = draftTextToHtml(text);
    if ((canonical === html || canonical.slice(3, -4) === html) && text.length <= DRAFT_BODY_LIMIT)
      return { text, editable: true };
  }
  if (!html) return { text: '', editable: true };
  return { text: displayHtmlToText(html.slice(0, 100_000)), editable: false };
}

/** Keep rich HTML intact while allowing a plain-text reply above it on mobile.
 * Web editors may remove data attributes; a final top-level quote still round-trips.
 */
export function mobileDraftBodyEditor(html: string): { text: string; quote: string } {
  const quoteStart = html.search(/<blockquote(?:\s[^>]*)?>/i);
  if (quoteStart >= 0 && /<\/blockquote>\s*$/i.test(html)) {
    const prefix = draftBodyEditor(html.slice(0, quoteStart));
    if (prefix.editable) return { text: prefix.text, quote: html.slice(quoteStart) };
  }
  const plain = draftBodyEditor(html);
  return plain.editable
    ? { text: plain.text, quote: '' }
    : { text: '', quote: `<blockquote data-lfx-quote="1">${html}</blockquote>` };
}

/** Empty recipients are legal for drafts; nonempty addresses must be valid before saving. */
export function validateDraft(d: MailDraftFields): string {
  if (!d.maid || !d.sender || d.maid.length > 32 || d.sender.length > 100)
    return 'mail.draftNoSender';
  if (
    !d.subject.trim() &&
    !displayHtmlToText(d.html).trim() &&
    !/<(?:img|video|audio)\b/i.test(d.html) &&
    !d.attachments?.length
  )
    return 'mail.draftEmpty';
  if (d.subject.length > 1024 || [d.to, d.cc, d.bcc].some((v) => v.length > 4096))
    return 'mail.draftTooLong';
  if ([d.to, d.cc, d.bcc].some((v) => splitAddresses(v).some((a) => !isValidAddress(a))))
    return 'mail.draftInvalidAddress';
  return '';
}

/** Explicit empty cc/bcc clear old values. Never include delivery/scheduling controls. */
export interface DraftSaveOptions {
  /** Only set after explicit attachment edits; [] removes the last attachment. */
  replaceAttachments?: boolean;
}
export function draftSaveBody(d: MailDraftFields, options: DraftSaveOptions = {}) {
  return {
    ...(d.id ? { id: d.id } : {}),
    ...(d.replyId ? { replyId: d.replyId } : {}),
    ...(d.forwardId ? { forwardId: d.forwardId } : {}),
    maid: d.maid,
    // mail-open may decorate/normalize the original sender. Preserve its stored value on edits.
    ...(!d.id ? { sender: d.sender } : {}),
    // Preserve server attachment metadata unless explicitly edited. Never touch attIds.
    ...((!d.id && d.attachments?.length) || options.replaceAttachments
      ? { attachments: draftAttachments(d.attachments ?? [], true) }
      : {}),
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    html: d.html || '<p></p>',
    // Keep search/snippets consistent after editing (the server does not derive text).
    text: displayHtmlToText(d.html),
  };
}
