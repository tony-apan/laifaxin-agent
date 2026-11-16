/**
 * 文件上传。后端不收文件本体 —— 三段式:
 *
 * 1. `POST /file/get-auth` 换一份阿里云 STS 临时凭证
 * 2. **浏览器直传 OSS**,不经过自家后端
 * 3. `POST /file/save-log` 把这次上传登记下来,响应里的 `data` 就是别处要用的「文件对象」
 *
 * 老项目的 `apiFileSaveLog` 在 api 层就把信封剥了(`const { data } = await request(...)`),
 * 于是 `success:false` 被吞掉,上传函数无论业务成败都返回成功。这里判过 success 才返回。
 */

/** OSS 目录前缀。老项目 UploadStep 有个 `saveType` prop 但从不使用,目录写死 'store' */
export type UploadKind = 'store' | 'att' | 'img' | 'avatar' | 'id';

export interface UploadAuth {
  /** 大驼峰是阿里云 STS 的原始拼写,别顺手改小 */
  SecurityToken: string;
  AccessKeyId: string;
  AccessKeySecret: string;
  region: string;
  bucket: string;
  uid: string;
  dirName: string;
  id: string;
  /** 自定义域名。给了就用它拼最终 url */
  webSite?: string;
}

/** save-log 登记完之后拿到的文件对象,导入与附件都直接透传它 */
export interface UploadedFile {
  id: string;
  iid: string;
  name: string;
  url: string;
  /** 真实 object key。**不是** `filename` —— 那个是 `${id}.${扩展名}`,当路径用会 404 */
  filePath: string;
  filename: string;
  bucket: string;
  region: string;
  dirName: string;
  uid: string;
  /** 浏览器给的 MIME,不是扩展名 */
  fileType: string;
  type: UploadKind;
  size: number;
}

export interface UploadFileInfo {
  name: string;
  size: number;
}

export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

/**
 * OSS object key。附件那一档**不带时间戳**,同名会互相覆盖 —— 老项目就是这样,
 * 后端按它去重,改了会对不上。
 */
export function ossKey(kind: UploadKind, dirName: string, id: string, name: string, now: number) {
  return kind === 'att'
    ? `${kind}/${dirName}/${id}/${name}`
    : `${kind}/${dirName}/${id}_${now}.${extOf(name)}`;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** 后缀黑名单。老项目写的是 `indexOf('.exe') > 0` 而且**提示完还继续上传** */
const BLOCKED_EXT = ['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'dll', 'sh'];

/** 返回 i18n key,没问题时返回空 */
/**
 * 给 i18n 插值用的上限文案。**别再各处手写「10MB」** ——
 * 写死的话常量一调,提示里的数字就跟真实门槛对不上,
 * 用户按提示压到 10MB 以内还是传不上去。
 */
export const MAX_UPLOAD_LABEL = `${MAX_UPLOAD_BYTES / 1024 / 1024}MB`;

export function checkUploadFile(file: UploadFileInfo, accept?: string[]): string {
  if (file.size >= MAX_UPLOAD_BYTES) return 'io.errTooLarge';
  if (BLOCKED_EXT.includes(extOf(file.name))) return 'io.errBadType';
  if (accept && !accept.includes(extOf(file.name))) return 'io.errWrongFormat';
  return '';
}
