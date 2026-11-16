/* 只读渲染子入口（阅读路径专用）：sanitize 清洗 + 正文排版类。
   刻意不经 index 主入口——barrel 会把编辑器整包（~28 kB gzip）拖进
   只读页面的 chunk；需要编辑能力时仍从目录根导入。 */
export { EDITOR_CONTENT_CLS } from './themes/default';
export { sanitizeEmailHtml } from './utils/sanitize';
