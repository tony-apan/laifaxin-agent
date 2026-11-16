/**
 * 翻译时保留 HTML 排版。
 *
 * 后端 `/tools/lang-translate` 只吃纯文本列表(`textList: string[]`),不吃 HTML ——
 * 把带标签的串送过去,回来的是被打散的标记。所以排版要靠前端保住:
 *
 * 1. 解析原 HTML,按文档顺序收集**文本节点**
 * 2. 同一个块级容器里相邻的行内文本节点**合并成一个翻译单元**
 * 3. 只把单元的文本送去翻译
 * 4. 译文**写回文本节点**,标签、属性、表格、图片、链接一个都不动
 *
 * 关键在第 4 步:改的是 `Text` 节点的 `data`,不是 `innerHTML`。普通元素里的译文
 * 序列化时会被转义成 `&lt;script&gt;`,变不回标签。
 *
 * ⚠️ **但 raw-text 标签是例外**:`<xmp>`/`<iframe>`/`<noembed>`/`<noframes>` 的
 * 文本子节点在序列化时是**字面输出、不转义**,译文里的 `</xmp><img src=x>` 会变成
 * 真的元素。实测过。所以它们进了 {@link SKIP_TAGS} —— 反正 `sanitizeEmailHtml`
 * 也会把它们连内容一起丢掉,翻了用户也看不见。
 *
 * 回填后的 HTML 照样要过 `MailBody` 的 `sanitizeEmailHtml` + 远程图片拦截 +
 * 沙箱 iframe,三道都不少。
 */

/* ---------- 什么不翻译 ---------- */

/**
 * 整棵子树都不翻。
 *
 * 前六个是「内容不给人读」;后五个是 **raw-text 标签** —— 它们的文本子节点
 * 序列化时不转义,译文能变成真元素(见文件头)。而且 `sanitizeEmailHtml`
 * 把这五个连内容一起丢掉,用户永远看不见,翻它等于白烧一格额度。
 * `PLAINTEXT` 尤其恶劣:它把文档剩下的部分整个吞成一个节点。
 */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TITLE',
  'HEAD',
  'NOSCRIPT',
  'TEMPLATE',
  'XMP',
  'IFRAME',
  'NOEMBED',
  'NOFRAMES',
  'PLAINTEXT',
]);

/**
 * 块级容器。文本节点跨过它就要另起一个翻译单元 ——
 * 否则一个 `<td>` 里的字会和隔壁 `<td>` 的字连成一句送去翻译。
 *
 * `BR` 也算:它在同一个 `<div>` 里分隔了两行,合并的话译文回填后
 * 那个 `<br>` 会跑到整段译文的末尾,原来的换行就没了。
 */
const BLOCK_TAGS = new Set([
  // ⚠️ `A` 在 HTML 里是行内的,这里当块级 —— 是刻意的,为了两件事:
  //
  //   1. 不合并的话锚文本会被清空。`<p>目录已就绪 <a href=…>下载</a></p>` 并成一个
  //      单元后,译文全进第一个节点、`<a>` 里被置空 —— 剩一个零宽的空壳,点不到。
  //      仓库自带的 mail-tracker 样本一跑就中。
  //   2. 反过来,`<p><a href="https://evil/pay">Verify</a> your account…</p>`
  //      的整句会被吸进那个 `<a>`,可点区域从一个词膨胀成一整句 —— 钓鱼邮件的放大器。
  //
  // 代价是含链接的句子会碎成几段,译文读起来是断的。但断句还能读,
  // 死链接和被撑大的钓鱼热区不切回原文就发现不了,而用户不会想到去切。
  'A',
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BR',
  'CAPTION',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
]);

/**
 * 值不值得送去翻译。
 *
 * 纯标点、纯数字、纯符号送过去只是白花额度,回来还常常被改动
 * (金额的千分位、日期的分隔符都可能被「本地化」掉)。
 * 判据是**有没有字母或汉字**,不是长度 —— 单个 `Hi` 该翻,`2026-09-01` 不该。
 */
export function worthTranslating(s: string): boolean {
  return /[\p{Letter}]/u.test(s);
}

/* ---------- 收集 ---------- */

export interface TextUnit {
  /** 送去翻译的文本(已折叠空白) */
  text: string;
  /** 这个单元覆盖的文本节点。译文回填到第一个,其余置空 */
  nodes: Text[];
  /** 原文前后的空白,回填时照原样补回去 —— 丢了会让行内元素黏在一起 */
  lead: string;
  trail: string;
}

/**
 * 把文档里的文本节点归并成翻译单元。
 *
 * 递归下降:碰到块级标签就**断开当前单元**,行内标签继续累积。
 * 第一版是收集完所有文本节点再两两判断「中间有没有隔着块级」——
 * 那是 O(n²),而且判断跨越公共祖先的那段逻辑绕到自己都不敢说一定对。
 * 下降着走的话,块级边界就是「进出这个元素」这一件事,不用回头比较。
 *
 * **合并行内节点是有代价的**:`Dear <b>Mr. Smith</b>, we received...` 会并成
 * 一个单元,译文只能整块塞回第一个节点、其余置空 —— 那个 `<b>` 的强调会丢。
 * 但不合并的代价更大:三个孤立碎片("Dear" / "Mr. Smith" / ", we received...")
 * 送去翻译,机器没有上下文,出来的中文是断的。
 *
 * 排版(段落、表格、图片、链接位置)是这次要保的东西,行内强调不是 —— 所以合并。
 */
export function collectUnits(doc: Document): TextUnit[] {
  const units: TextUnit[] = [];
  /** 当前还开着的单元;null 表示下一段文本要另起一个 */
  let open: TextUnit | null = null;

  const visit = (parent: Node): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const node = child as Text;
        const raw = node.data;
        if (!raw.trim()) {
          // 纯空白节点本身不成段,但它是一次「空格机会」——
          // 丢了的话 `<span>请确认</span> <span>周五前</span>` 会粘成「请确认周五前」
          if (open) open.trail = ' ';
          continue;
        }
        const body = raw.replace(/\s+/g, ' ').trim();
        if (open) {
          // 节点之间原本的空白要留一格,否则 "Dear" 和 "Mr." 会黏成 "DearMr."
          const gap = /\s$/.test(open.trail) || /^\s/.test(raw) ? ' ' : '';
          open.text += gap + body;
          open.nodes.push(node);
          open.trail = raw.match(/\s*$/)?.[0] ?? '';
        } else {
          open = {
            text: body,
            nodes: [node],
            lead: raw.match(/^\s*/)?.[0] ?? '',
            trail: raw.match(/\s*$/)?.[0] ?? '',
          };
          units.push(open);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (SKIP_TAGS.has(el.tagName)) continue;
        if (BLOCK_TAGS.has(el.tagName)) {
          open = null; // 进块级:断开
          visit(el);
          open = null; // 出块级:再断开
        } else {
          visit(el); // 行内:继续累积
        }
      }
    }
  };

  visit(doc.body);
  return units;
}

/* ---------- 回填 ---------- */

/**
 * 把译文写回文本节点,序列化成 HTML。
 *
 * `translated` 与 `units` 按下标一一对应。**长度对不上是常态,不是异常** ——
 * 后端可能少回、多回、或某项是空串,所以这里逐个用 `??` 兜到原文,
 * 而不是先校验长度再整体放弃:一封邮件因为最后一段没翻回来就整篇不翻,
 * 比部分翻译更糟。
 */
export function applyTranslations(units: TextUnit[], translated: string[]): void {
  units.forEach((u, i) => {
    const out = translated[i];
    // 空串当没翻 —— 后端偶尔会对纯符号段回空
    if (typeof out !== 'string' || !out.trim()) return;
    // 写的是 Text.data,不是 innerHTML:译文里的尖括号会被序列化成实体,永远变不回标签
    u.nodes[0].data = u.lead + out + u.trail;
    for (let k = 1; k < u.nodes.length; k++) u.nodes[k].data = '';
  });
}

export interface HtmlTranslation {
  /** 送去翻译的文本,按顺序 */
  textList: string[];
  /** 拿到译文后回填,得到新的 HTML */
  apply: (translated: string[]) => string;
  /** 有多少个单元(用来判断有没有超上限) */
  count: number;
}

/**
 * 准备一次「保排版」的翻译。
 *
 * 拆成 prepare / apply 两步而不是一个 async 函数:调用方要先拿到 `textList`
 * 才能拼请求,拿到响应后再回填 —— 中间那次网络请求由调用方发,
 * 这一层不碰网络,于是它是纯函数,可测。
 */
export function prepareHtmlTranslation(html: string): HtmlTranslation {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const units = collectUnits(doc).filter((u) => worthTranslating(u.text));
  return {
    textList: units.map((u) => u.text),
    count: units.length,
    apply: (translated) => {
      applyTranslations(units, translated);
      return doc.body.innerHTML;
    },
  };
}
