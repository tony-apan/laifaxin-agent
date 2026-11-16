import type { UploadAuth, UploadedFile, UploadKind } from '@laifaxin/core/upload';
import { extOf, ossKey } from '@laifaxin/core/upload';

export type { UploadAuth, UploadedFile, UploadKind } from '@laifaxin/core/upload';
export { checkUploadFile, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, ossKey } from '@laifaxin/core/upload';

import { AuthError, postEnvelopeFull } from '@/api/auth';

export async function getUploadAuth(type: UploadKind): Promise<UploadAuth> {
  const res = await postEnvelopeFull<UploadAuth>(
    '/file/get-auth',
    { type },
    { readErrorMessage: true },
  );
  if (!res.data) throw new AuthError(res.message?.trim() || '未能获取上传凭证，请重试');
  return res.data;
}

/** 登记上传。**不剥信封** —— 业务失败要能被上层看见 */
export async function saveUploadLog(log: Record<string, unknown>): Promise<UploadedFile> {
  const res = await postEnvelopeFull<UploadedFile>('/file/save-log', log, {
    readErrorMessage: true,
  });
  if (!res.data?.url?.trim()) throw new AuthError(res.message?.trim() || '上传登记失败,请重试');
  return res.data;
}

/** 用临时凭证签名直传；演示模式交给 MSW，不向真实 OSS 发送演示凭证。 */
export async function putObject(auth: UploadAuth, key: string, file: File): Promise<string> {
  const base = auth.webSite ?? `https://${auth.bucket}.oss-accelerate.aliyuncs.com`;
  const url = `${base}/${key}`;
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail: string | undefined;
      if (text.trimStart().startsWith('{')) {
        try {
          const body = JSON.parse(text);
          if (typeof body?.message === 'string') detail = body.message;
        } catch {
          // 无有效服务端文案时使用默认提示。
        }
      } else if (text.trimStart().startsWith('<')) {
        const xml = new DOMParser().parseFromString(text, 'application/xml');
        detail = xml.querySelector('Error > Message')?.textContent ?? undefined;
      } else if (res.headers.get('content-type')?.startsWith('text/plain')) {
        detail = text;
      }
      throw new AuthError(detail?.trim() || '文件上传失败,请重试');
    }
  } else {
    const { default: OSS } = await import('ali-oss');
    const client = new OSS({
      bucket: auth.bucket,
      region: auth.region,
      accessKeyId: auth.AccessKeyId,
      accessKeySecret: auth.AccessKeySecret,
      stsToken: auth.SecurityToken,
      endpoint: 'oss-accelerate.aliyuncs.com',
      secure: true,
    });
    try {
      await client.put(key, file, {
        mime: file.type,
        headers: key.startsWith('att/')
          ? { 'Content-Disposition': 'attachment', 'Cache-Control': 'no-cache' }
          : {},
      });
    } catch (error) {
      // SDK 将 OSS 的 Code 和 Message 解析到异常上；断网或签名异常没有服务端文案。
      if (
        error instanceof Error &&
        'status' in error &&
        typeof error.status === 'number' &&
        error.status > 0 &&
        'code' in error &&
        error.code &&
        error.message.trim()
      ) {
        throw new AuthError(error.message.trim());
      }
      throw new AuthError('文件上传失败,请重试');
    }
  }
  return url;
}

/** 三段走完,拿到可以直接交给业务接口的文件对象 */
export async function uploadFile(
  file: File,
  kind: UploadKind,
  now = Date.now(),
): Promise<UploadedFile> {
  const auth = await getUploadAuth(kind);
  const key = ossKey(kind, auth.dirName, auth.id, file.name, now);
  const url = await putObject(auth, key, file);
  return saveUploadLog({
    // iid 与 id 是同一个值,后端两个键都要
    iid: auth.id,
    id: auth.id,
    name: file.name,
    url,
    filePath: key,
    bucket: auth.bucket,
    region: auth.region,
    filename: `${auth.id}.${extOf(file.name)}`,
    dirName: auth.dirName,
    uid: auth.uid,
    fileType: file.type,
    type: kind,
    size: file.size,
  });
}

/** `1.4 MB`。列表与附件条都用它 */
export function fmtFileSize(bytes: number) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
