import './email-content.css';

/* 编辑区和模板预览共用。布局表格不能套用数据表的边框、内边距；
   工具栏新建表格自带可发送的内联样式。原邮件引用另行恢复邮件排版基线。 */
export const EDITOR_CONTENT_CLS = [
  'email-content text-sm leading-relaxed',
  '[&_a]:text-accent [&_a]:underline',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted',
  '[&_img]:max-w-full',
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6',
].join(' ');
