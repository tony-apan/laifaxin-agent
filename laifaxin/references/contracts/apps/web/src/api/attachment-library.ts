import { postEnvelope } from './auth';
import { normalizeMailFileUrl } from './mail-file-url';
import type { UploadedFile } from './upload';

export interface LibraryAttachment {
  id: string;
  name: string;
  showname: string;
  size: number;
  url?: string;
  create_time?: number;
}
export const listLibraryAttachments = () =>
  postEnvelope<(Omit<LibraryAttachment, 'id'> & { _id?: string; id?: string })[] | undefined>(
    '/mailbox/attachment-items',
    {},
  ).then((rows) =>
    (rows ?? []).map((row) => ({ ...row, id: row._id ?? row.id ?? '' })).filter((row) => row.id),
  );
export const registerLibraryAttachment = (file: UploadedFile) =>
  postEnvelope<{ id?: string }>('/mailbox/attachment-save', {
    id: file.id,
    name: file.name,
    showname: file.name,
  });
export const deleteLibraryAttachment = (id: string) =>
  postEnvelope('/mailbox/attachment-delete', { id });

export function attachmentPreviewUrl(raw?: string, filename?: string): string {
  if (!raw) return '';
  try {
    // 旧接口直接拼接原始文件名，百分号、#、? 等不能被当成 URL 的转义或分隔符。
    const source =
      filename && raw.endsWith(`/${filename}`)
        ? raw.slice(0, -filename.length) + encodeURIComponent(filename)
        : raw;
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? normalizeMailFileUrl(url).href
      : '';
  } catch {
    return '';
  }
}
export function attachmentPreviewKind(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'image';
  if (ext && ['txt', 'csv', 'log', 'json', 'md'].includes(ext)) return 'text';
  return 'download';
}

export const getLibraryAttachmentPreview = (id: string) =>
  postEnvelope<{ text?: string; base64?: string; mime?: string }>('/mailbox/attachment-preview', {
    id,
  });
