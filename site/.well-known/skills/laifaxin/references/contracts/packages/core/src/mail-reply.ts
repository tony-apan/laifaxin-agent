import { isDraftsBox, type MailDetail } from './mail';
import { addressEmail, dedupeAddresses, isValidAddress, splitAddresses } from './mail-address';
import { mailContent, serializeMailContent } from './mail-content';
import {
  DRAFT_BODY_LIMIT,
  draftAttachments,
  draftTextToHtml,
  type MailDraftFields,
} from './mail-drafts';
import { type MailLocation, mailText } from './mail-mobile';
import { displayHtmlToText } from './text';

export type ReplyMode = 'reply' | 'replyAll';
export type SourceDraftMode = ReplyMode | 'forward';
export interface ReplyQuoteLabels {
  original: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  time: string;
  noBody: string;
  locale: 'zh-CN' | 'en-US';
}

export const canReply = (mail: MailDetail) =>
  !isDraftsBox(mailText(mail.boxName)) && mail.status !== 9;

/** Bcc never becomes a visible recipient or part of the quoted headers. */
export function replyRecipients(mail: MailDetail, mode: ReplyMode, ownAddresses: string[]) {
  const own = new Set(ownAddresses.map(addressEmail).filter(Boolean));
  const strip = (list: string[]) =>
    dedupeAddresses(list).filter((address) => !own.has(addressEmail(address)));
  const from = strip(splitAddresses(mailText(mail.from) || mailText(mail.sender)));
  const originalTo = strip(splitAddresses(mailText(mail.to)));
  const to = mode === 'reply' ? (from.length ? from : originalTo) : strip([...from, ...originalTo]);
  const toEmails = new Set(to.map(addressEmail));
  const cc =
    mode === 'replyAll'
      ? strip(splitAddresses(mailText(mail.cc))).filter(
          (address) => !toEmails.has(addressEmail(address)),
        )
      : [];
  return { to: to.join(','), cc: cc.join(','), bcc: '' };
}

/** Quote text only, with explicit size/body failures rather than silently quoting a preview. */
export function replyBody(
  mail: MailDetail,
  labels: ReplyQuoteLabels,
  action: 'reply' | 'forward' = 'reply',
): string {
  const html = mailText(mail.html);
  const source = html && html !== 'false' ? html : mailText(mail.text);
  const unavailable =
    action === 'forward' ? 'mail.forwardBodyUnavailable' : 'mail.replyBodyUnavailable';
  const tooLong = action === 'forward' ? 'mail.forwardTooLong' : 'mail.replyTooLong';
  if (!source && mail.downloadUrl) throw new Error(unavailable);
  if (source.length > 1_000_000) throw new Error(tooLong);
  const text = html && html !== 'false' ? displayHtmlToText(source) : source;
  const when =
    typeof mail.timestamp === 'number' && Number.isFinite(new Date(mail.timestamp).getTime())
      ? new Date(mail.timestamp).toLocaleString(labels.locale)
      : '—';
  const lines = [
    `---------- ${labels.original} ----------`,
    `${labels.from}: ${mailText(mail.from) || mailText(mail.sender) || '—'}`,
    `${labels.time}: ${when}`,
    `${labels.to}: ${mailText(mail.to) || '—'}`,
    ...(mail.cc ? [`${labels.cc}: ${mailText(mail.cc)}`] : []),
    `${labels.subject}: ${mailText(mail.subject)}`,
    '',
    text || labels.noBody,
  ];
  const body = `\n\n${lines.join('\n')}`;
  // Leave room above the quote for the user's reply.
  if (body.length > DRAFT_BODY_LIMIT - 5_000) throw new Error(tooLong);
  return body;
}

/** Keep the quotation separate from new text so clients can collapse it without losing content. */
function sourceHtml(mail: MailDetail, labels: ReplyQuoteLabels, action: 'reply' | 'forward') {
  const content = mailContent(mail);
  if (content.blockedImages) throw new Error('mail.inlineImagesUnavailable');
  if (!content.images.length && !content.truncated)
    return `<p></p><blockquote data-lfx-quote="1">${draftTextToHtml(replyBody(mail, labels, action))}</blockquote>`;
  if (content.truncated)
    throw new Error(action === 'forward' ? 'mail.forwardTooLong' : 'mail.replyTooLong');
  // Headers are escaped independently. Never place source sender/subject inside markup.
  const headers = replyBody(
    { ...mail, html: '', text: '', downloadUrl: '' },
    { ...labels, noBody: '' },
    action,
  );
  return `<p></p><blockquote data-lfx-quote="1">${draftTextToHtml(headers)}${serializeMailContent(content.nodes)}</blockquote>`;
}

export function replyDraft(
  mail: MailDetail,
  mode: ReplyMode,
  accounts: MailLocation[],
  labels: ReplyQuoteLabels,
  identities = accounts,
): MailDraftFields {
  return sourceDraft(mail, mode, accounts, labels, identities);
}

export function forwardDraft(
  mail: MailDetail,
  accounts: MailLocation[],
  labels: ReplyQuoteLabels,
): MailDraftFields {
  return sourceDraft(mail, 'forward', accounts, labels, accounts);
}

function sourceDraft(
  mail: MailDetail,
  mode: SourceDraftMode,
  accounts: MailLocation[],
  labels: ReplyQuoteLabels,
  identities: MailLocation[],
): MailDraftFields {
  const action = mode === 'forward' ? 'forward' : 'reply';
  if (!canReply(mail))
    throw new Error(mode === 'forward' ? 'mail.forwardUnavailable' : 'mail.replyUnavailable');
  if (!mail._id || mail._id.length < 6 || mail._id.length > 64) throw new Error('mail.notFound');
  const ownAddresses = identities
    .flatMap((account) => [account.boxName, account.name])
    .filter(isValidAddress);
  const sender =
    accounts.find((account) => account.maid === mail.maid) ??
    accounts.find(
      (account) => addressEmail(account.boxName) === addressEmail(mailText(mail.sender)),
    ) ??
    accounts[0];
  if (!sender) throw new Error('mail.draftNoSender');
  if (mode === 'forward' && mail.attach && !mail.attachments?.length)
    throw new Error('mail.forwardAttachmentsUnavailable');
  const subject = mailText(mail.subject).trim();
  return {
    maid: sender.maid,
    sender: isValidAddress(sender.boxName) ? sender.boxName : sender.name,
    ...(mode === 'forward'
      ? { to: '', cc: '', bcc: '' }
      : replyRecipients(mail, mode, ownAddresses)),
    subject:
      mode === 'forward'
        ? /^fw:\s*/i.test(subject)
          ? subject
          : `Fw: ${subject}`
        : /^re:\s*/i.test(subject)
          ? subject
          : `Re: ${subject}`,
    html: sourceHtml(mail, labels, action),
    ...(mode === 'forward'
      ? { forwardId: mail._id, attachments: draftAttachments(mail.attachments, true) }
      : { replyId: mail._id }),
  };
}
