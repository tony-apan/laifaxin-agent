import DOMPurify from 'dompurify';

// 变量是整体占位符。仅恢复已清洗的变量 code 标记，不允许邮件自带可编辑内容。
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'CODE' && node.getAttribute('class') === 'lfxFieldVeriable') {
    node.setAttribute('contenteditable', 'false');
  }
});

/* 邮件 HTML 清洗（RichTextEditor 粘贴与预览双关卡共用）：
   目标是「保真 + 安全」——保留邮件常见的呈现性标记（内联 style、
   table 布局、font 标签、图片），只剿杀可执行内容。
   DOMPurify 默认已允许 style 属性并清洗 script / on* 事件 /
   javascript: 协议；此处显式补充邮件场景的表格与 font 标签。 */
export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['font', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col'],
    ADD_ATTR: [
      'face',
      'size',
      'color',
      'align',
      'valign',
      'cellpadding',
      'cellspacing',
      'border',
      'bgcolor',
      'width',
      'height',
      'target',
    ],
    /* 邮件里不应出现的可交互/加载型标签 */
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
  });
}
