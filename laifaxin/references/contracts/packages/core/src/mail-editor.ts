import { Parser } from 'htmlparser2';
import { escapeMailHtml } from './mail-content';

/** A deliberately small, reversible subset shared by native Editor and Web mail HTML.
 * Unsupported source content stays outside the editor, untouched, as a quoted original. */
export function normalizeEditorHtml(html: string): string | null {
  if (html.length > 500_000) return null;
  let valid = true;
  let output = '';
  let count = 0;
  const tags = new Set('p div span br b strong i em u s strike ul ol li'.split(' '));
  const stack: string[] = [];
  const styles = new Map([
    ['font-weight', /^(?:normal|bold|[1-9]00)$/],
    ['font-style', /^(?:normal|italic)$/],
    ['text-decoration', /^(?:none|underline|line-through|underline line-through)$/],
    ['text-align', /^(?:left|center|right|justify)$/],
    ['color', /^(?:#[a-f0-9]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i],
    ['background-color', /^(?:#[a-f0-9]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i],
    ['font-size', /^(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)|small|large|normal)$/],
    ['line-height', /^(?:normal|\d+(?:\.\d+)?(?:px|em|%)?)$/],
    ['padding-left', /^\d+(?:\.\d+)?(?:px|em)$/],
  ]);
  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        if (!tags.has(tag) || ++count > 4000 || stack.length > 32) valid = false;
        const css = new Map<string, string>();
        for (const [name, value] of Object.entries(attrs)) {
          if (name === 'style') {
            for (const declaration of value.split(';').filter((n) => n.trim())) {
              const colon = declaration.indexOf(':');
              const key = declaration.slice(0, colon).trim().toLowerCase();
              const val = declaration.slice(colon + 1).trim();
              if (colon < 1 || !styles.get(key)?.test(val)) valid = false;
              else css.set(key, val);
            }
          } else if (name === 'class') {
            for (const cls of value.split(/\s+/).filter(Boolean)) {
              const align = /^ql-align-(left|center|right|justify)$/.exec(cls);
              const indent = /^ql-indent-([1-8])$/.exec(cls);
              if (align) css.set('text-align', align[1]);
              else if (indent) css.set('padding-left', `${Number(indent[1]) * 3}em`);
              else valid = false;
            }
          } else valid = false;
        }
        output += `<${tag}${css.size ? ` style="${[...css].map(([k, v]) => `${k}:${v}`).join(';')}"` : ''}>`;
        stack.push(tag);
      },
      ontext(text) {
        output += escapeMailHtml(text);
        if (++count > 4000) valid = false;
      },
      oncomment() {
        valid = false;
      },
      onprocessinginstruction() {
        valid = false;
      },
      onclosetag(tag) {
        stack.pop();
        if (tag !== 'br') output += `</${tag}>`;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  return valid ? output || '<p></p>' : null;
}
