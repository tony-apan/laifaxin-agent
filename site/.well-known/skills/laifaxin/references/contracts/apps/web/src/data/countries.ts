/**
 * 国家 / 地区参照表。245 条,以旧项目 `src/sections/search/config.ts` 的 `CountriesData`
 * 正文为基(它比 `config/country-data.ts` 那份多一条科索沃,其余 244 行逐字段相同)。
 *
 * **为什么不用 Intl.DisplayNames 生成。** 展示名 Intl 完全够用(245 个 alpha-2 全部解析成功)。
 * 但 `en` 不只是展示名,它是**发给后端的筛选值**,而其中 40 条与 Intl 的英文名对不上
 * (Korea / South Korea、Turkey / Türkiye、Swaziland / Eswatini …)。拿 Intl 生成筛选值,
 * 这 40 个国家会静默筛不出任何东西 —— 不报错、不空白,只是结果不对。
 * 另外 `py`(拼音首字母,用于中文输入搜索)和 `continent`(分组)Intl 根本没有。
 *
 * **哨兵不进这张表。** 旧项目为了「带不带全球 / 带不带未知」拆出四个导出
 * (CountriesData / CountriesOptions / CountriesOptionsWithUnkown / LocalCountriesData),
 * 于是同名不同值、`slice(1)` 依赖顺序、`if (!option.code)` 当判别位这类写法到处都是。
 * 这里基表只装真实国家,「未知」和「不限」由使用方的选项处理。
 *
 * **丢掉了 alpha-3 与 ISO 数字码两列**:全库没有一个真实消费点,而且恰好是被污染最重的两列
 * (UM 的 alpha-3 被一次全局替换写成了 `@umijs/max`,科索沃整行照抄了塞尔维亚的码)。
 *
 * **这一层没有 index.ts,一律深路径 import。** 加了 barrel 之后
 * `import { X } from '@/data'` 会把所有表拽进同一个 chunk;现在这张表被自动切成了
 * 独立 chunk(19.6 KB / 7.3 KB gzip),主包只涨了 0.45 KB gzip。
 *
 * 生成时已修掉的脏数据,别再改回去(`countries.test.ts` 会拦):
 * - DE / KW / ME 三条 `full` 掉了 the 的首字母(`he Federal Republic of Germany`)
 * - MR 的中文名是「毛利塔尼亚」,应为「毛里塔尼亚」
 *
 * ⚠️ `py` 有 8 组重复(安哥拉/安圭拉都是 agl、德国/多哥都是 dg …),**不能当唯一键**,
 * 只能用于 includes 子串搜索。唯一键永远是 `abb2`。
 */

/** 七大洲。值域与下表 `continent` 列严格对齐 —— 旧项目把这七个名字硬编码在三个组件里 */
export const CONTINENTS = ['亚洲', '欧洲', '北美洲', '南美洲', '非洲', '大洋洲', '南极洲'] as const;
export type Continent = (typeof CONTINENTS)[number];

export interface Country {
  /** ISO alpha-2,大写。**唯一键**,也是发给后端的 `company_code` */
  abb2: string;
  cn: string;
  /** 发给后端的行业无关筛选值(`company_country`),不是纯展示名 */
  en: string;
  /** 官方全称。参与搜索匹配的兜底 */
  full: string;
  /** 拼音首字母,中文输入时用来搜。**有重复,不能当键** */
  py: string;
  continent: Continent | '其他';
}

/** 列顺序:abb2, cn, en, full, py, continent。写成元组是为了让一国占一行、便于 diff */
type Row = readonly [string, string, string, string, string, string];

const ROWS: readonly Row[] = [
  ['AF', '阿富汗', 'Afghanistan', 'the Islamic Republic of Afghanistan', 'afh', '亚洲'],
  ['AX', '奥兰群岛', 'Aland Islands', 'Aland Islands', 'alqd', '欧洲'],
  ['AL', '阿尔巴尼亚', 'Albania', 'the Republic of Albania', 'aebny', '欧洲'],
  ['DZ', '阿尔及利亚', 'Algeria', "the People's Democratic Republic of Algeria", 'aejly', '非洲'],
  ['AS', '美属萨摩亚', 'American Samoa', 'American Samoa', 'mssmy', '大洋洲'],
  ['AD', '安道尔', 'Andorra', 'the Principality of Andorra', 'ade', '欧洲'],
  ['AO', '安哥拉', 'Angola', 'the Republic of Angola', 'agl', '非洲'],
  ['AI', '安圭拉', 'Anguilla', 'Anguilla', 'agl', '北美洲'],
  ['AQ', '南极洲', 'Antarctica', 'Antarctica', 'njz', '南极洲'],
  ['AG', '安提瓜和巴布达', 'Antigua and Barbuda', 'Antigua and Barbuda', 'atdhbbd', '北美洲'],
  ['AR', '阿根廷', 'Argentina', 'the Argentine Republic', 'agt', '南美洲'],
  ['AM', '亚美尼亚', 'Armenia', 'the Republic of Armenia', 'ymny', '亚洲'],
  ['AW', '阿鲁巴', 'Aruba', 'Aruba', 'alb', '北美洲'],
  ['AU', '澳大利亚', 'Australia', 'Australia', 'adly', '大洋洲'],
  ['AT', '奥地利', 'Austria', 'the Republic of Austria', 'adl', '欧洲'],
  ['AZ', '阿塞拜疆', 'Azerbaijan', 'the Republic of Azerbaijan', 'asbj', '亚洲'],
  ['BS', '巴哈马', 'Bahamas', 'the Commonwealth of The Bahamas', 'bhm', '北美洲'],
  ['BH', '巴林', 'Bahrain', 'the Kingdom of Bahrain', 'bl', '亚洲'],
  ['BD', '孟加拉国', 'Bangladesh', "the People's Republic of Bangladesh", 'mjlg', '亚洲'],
  ['BB', '巴巴多斯', 'Barbados', 'Barbados', 'bbds', '北美洲'],
  ['BY', '白俄罗斯', 'Belarus', 'the Republic of Belarus', 'bels', '欧洲'],
  ['BE', '比利时', 'Belgium', 'the Kingdom of Belgium', 'bls', '欧洲'],
  ['BZ', '伯利兹', 'Belize', 'Belize', 'blz', '北美洲'],
  ['BJ', '贝宁', 'Benin', 'the Republic of Benin', 'bn', '非洲'],
  ['BM', '百慕大', 'Bermuda', 'Bermuda', 'bmd', '北美洲'],
  ['BT', '不丹', 'Bhutan', 'the Kingdom of Bhutan', 'bd', '亚洲'],
  ['BO', '玻利维亚', 'Bolivia', 'the Republic of Bolivia', 'blwy', '南美洲'],
  ['BA', '波黑', 'Bosnia and Herzegovina', 'Bosnia and Herzegovina', 'bh', '欧洲'],
  ['BW', '博茨瓦纳', 'Botswana', 'the Republic of Botswana', 'bcwn', '非洲'],
  ['BV', '布维岛', 'Bouvet Island', 'Bouvet Island', 'bwd', '南极洲'],
  ['BR', '巴西', 'Brazil', 'the Federative Republic of Brazil', 'bx', '南美洲'],
  [
    'IO',
    '英属印度洋领地',
    'British Indian Ocean Territory',
    'British Indian Ocean Territory',
    'yzsydyld',
    '非洲',
  ],
  ['BN', '文莱', 'Brunei Darussalam', 'Brunei Darussalam', 'wl', '亚洲'],
  ['BG', '保加利亚', 'Bulgaria', 'the Republic of Bulgaria', 'bjly', '欧洲'],
  ['BF', '布基纳法索', 'Burkina Faso', 'Burkina Faso', 'bjnfs', '非洲'],
  ['BI', '布隆迪', 'Burundi', 'the Republic of Burundi', 'bld', '非洲'],
  ['KH', '柬埔寨', 'Cambodia', 'the Kingdom of Cambodia', 'jpz', '亚洲'],
  ['CM', '喀麦隆', 'Cameroon', 'the Republic of Cameroon', 'kml', '非洲'],
  ['CA', '加拿大', 'Canada', 'Canada', 'jnd', '北美洲'],
  ['CV', '佛得角', 'Cape Verde', 'the Republic of Cape Verde', 'fdj', '非洲'],
  ['KY', '开曼群岛', 'Cayman Islands', 'Cayman Islands', 'kmqd', '北美洲'],
  ['CF', '中非', 'Central African', 'the Central African Republic', 'zf', '非洲'],
  ['TD', '乍得', 'Chad', 'the Republic of Chad', 'zd', '非洲'],
  ['CL', '智利', 'Chile', 'the Republic of Chile', 'zl', '南美洲'],
  ['CN', '中国', 'China', "the People's Republic of China", 'zg', '亚洲'],
  ['CX', '圣诞岛', 'Christmas Island', 'Christmas Island', 'sdd', '亚洲'],
  [
    'CC',
    '科科斯（基林）群岛',
    'Cocos (Keeling) Islands',
    'Cocos (Keeling) Islands',
    'kksjlqd',
    '亚洲',
  ],
  ['CO', '哥伦比亚', 'Colombia', 'the Republic of Colombia', 'glby', '南美洲'],
  ['KM', '科摩罗', 'Comoros', 'the Union of the Comoros', 'kml', '非洲'],
  ['CG', '刚果（布）', 'Congo', 'the Republic of the Congo', 'ggb', '非洲'],
  [
    'CD',
    '刚果（金）',
    'Congo (the Democratic Republic of the)',
    'the Democratic Republic of the Congo',
    'ggj',
    '非洲',
  ],
  ['CK', '库克群岛', 'Cook Islands', 'Cook Islands', 'kkqd', '大洋洲'],
  ['CR', '哥斯达黎加', 'Costa Rica', 'the Republic of Costa Rica', 'gsdlj', '北美洲'],
  ['CI', '科特迪瓦', "Côte d'Ivoire", "the Republic of Côte d'Ivoire", 'ktdw', '非洲'],
  ['HR', '克罗地亚', 'Croatia', 'the Republic of Croatia', 'kldy', '欧洲'],
  ['CU', '古巴', 'Cuba', 'the Republic of Cuba', 'gb', '北美洲'],
  ['CY', '塞浦路斯', 'Cyprus', 'the Republic of Cyprus', 'spls', '欧洲'],
  ['CZ', '捷克', 'Czechia', 'the Czech Republic', 'jk', '欧洲'],
  ['DK', '丹麦', 'Denmark', 'the Kingdom of Denmark', 'dm', '欧洲'],
  ['DJ', '吉布提', 'Djibouti', 'the Republic of Djibouti', 'jbt', '非洲'],
  ['DM', '多米尼克', 'Dominica', 'the Commonwealth of Dominica', 'dmnk', '北美洲'],
  ['DO', '多米尼加', 'Dominican', 'Dominican Republic', 'dmnj', '北美洲'],
  ['EC', '厄瓜多尔', 'Ecuador', 'the Republic of Ecuador', 'egde', '南美洲'],
  ['EG', '埃及', 'Egypt', 'the Arab Republic of Egypt', 'aj', '非洲'],
  ['SV', '萨尔瓦多', 'El Salvador', 'the Republic of El Salvador', 'sewd', '北美洲'],
  ['GQ', '赤道几内亚', 'Equatorial Guinea', 'the Republic of Equatorial Guinea', 'cdjny', '非洲'],
  ['ER', '厄立特里亚', 'Eritrea', 'Eritrea', 'eltly', '非洲'],
  ['EE', '爱沙尼亚', 'Estonia', 'the Republic of Estonia', 'asny', '欧洲'],
  ['ET', '埃塞俄比亚', 'Ethiopia', 'the Federal Democratic Republic of Ethiopia', 'aseby', '非洲'],
  [
    'FK',
    '福克兰群岛（马尔维纳斯）',
    'Falkland Islands',
    'Falkland Islands [Malvinas]',
    'fklqdmewns',
    '非洲',
  ],
  ['FO', '法罗群岛', 'Faroe Islands', 'Faroe Islands', 'flqd', '欧洲'],
  ['FJ', '斐济', 'Fiji', 'the Republic of the Fiji Islands', 'fj', '大洋洲'],
  ['FI', '芬兰', 'Finland', 'the Republic of Finland', 'fl', '欧洲'],
  ['FR', '法国', 'France', 'the French Republic', 'fg', '欧洲'],
  ['GF', '法属圭亚那', 'French Guiana', 'French Guiana', 'fzsgyn', '南美洲'],
  ['PF', '法属波利尼西亚', 'French Polynesia', 'French Polynesia', 'fsblnxy', '大洋洲'],
  [
    'TF',
    '法属南部领地',
    'French Southern Territories',
    'French Southern Territories',
    'fsnbld',
    '非洲',
  ],
  ['GA', '加蓬', 'Gabon', 'the Gabonese Republic', 'jp', '非洲'],
  ['GM', '冈比亚', 'Gambia', 'the Republic of The Gambia', 'gby', '非洲'],
  ['GE', '格鲁吉亚', 'Georgia', 'Georgia', 'gljy', '亚洲'],
  ['DE', '德国', 'Germany', 'the Federal Republic of Germany', 'dg', '欧洲'],
  ['GH', '加纳', 'Ghana', 'the Republic of Ghana', 'jn', '非洲'],
  ['GI', '直布罗陀', 'Gibraltar', 'Gibraltar', 'zblt', '欧洲'],
  ['GR', '希腊', 'Greece', 'the Hellenic Republic', 'xl', '欧洲'],
  ['GL', '格陵兰', 'Greenland', 'Greenland', 'gll', '北美洲'],
  ['GD', '格林纳达', 'Grenada', 'Grenada', 'glnd', '北美洲'],
  ['GP', '瓜德罗普', 'Guadeloupe', 'Guadeloupe', 'gdlp', '北美洲'],
  ['GU', '关岛', 'Guam', 'Guam', 'gd', '北美洲'],
  ['GT', '危地马拉', 'Guatemala', 'the Republic of Guatemala', 'wdml', '北美洲'],
  ['GG', '格恩西岛', 'Guernsey', 'Guernsey', 'gexd', '欧洲'],
  ['GN', '几内亚', 'Guinea', 'the Republic of Guinea', 'jny', '非洲'],
  ['GW', '几内亚比绍', 'Guinea-Bissau', 'the Republic of Guinea-Bissau', 'jnybs', '非洲'],
  ['GY', '圭亚那', 'Guyana', 'the Republic of Guyana', 'gyn', '北美洲'],
  ['HT', '海地', 'Haiti', 'the Republic of Haiti', 'hd', '北美洲'],
  [
    'HM',
    '赫德岛和麦克唐纳岛',
    'Heard Island and McDonald Islands',
    'Heard Island and McDonald Islands',
    'hddhmktnd',
    '非洲',
  ],
  ['VA', '梵蒂冈', 'Holy See', 'Holy See [Vatican City State]', 'fdg', '欧洲'],
  ['HN', '洪都拉斯', 'Honduras', 'the Republic of Honduras', 'hdls', '北美洲'],
  [
    'HK',
    '香港(中国)',
    'Hong Kong',
    'the Hong Kong (China) Special Administrative Region of China',
    'xgzg',
    '亚洲',
  ],
  ['HU', '匈牙利', 'Hungary', 'the Republic of Hungary', 'xyl', '欧洲'],
  ['IS', '冰岛', 'Iceland', 'the Republic of Iceland', 'bd', '欧洲'],
  ['IN', '印度', 'India', 'the Republic of India', 'yd', '亚洲'],
  ['ID', '印度尼西亚', 'Indonesia', 'the Republic of Indonesia', 'ydnxy', '亚洲'],
  ['IR', '伊朗', 'Iran', 'the Islamic Republic of Iran', 'yl', '亚洲'],
  ['IQ', '伊拉克', 'Iraq', 'the Republic of Iraq', 'ylk', '亚洲'],
  ['IE', '爱尔兰', 'Ireland', 'Ireland', 'ael', '欧洲'],
  ['IM', '英国属地曼岛', 'Isle of Man', 'Isle of Man', 'ygsdmd', '欧洲'],
  ['IL', '以色列', 'Israel', 'the State of Israel', 'ysl', '亚洲'],
  ['IT', '意大利', 'Italy', 'the Republic of Italy', 'ydl', '欧洲'],
  ['JM', '牙买加', 'Jamaica', 'Jamaica', 'ymj', '北美洲'],
  ['JP', '日本', 'Japan', 'Japan', 'rb', '亚洲'],
  ['JE', '泽西岛', 'Jersey', 'Jersey', 'zxd', '欧洲'],
  ['JO', '约旦', 'Jordan', 'the Hashemite Kingdom of Jordan', 'yd', '亚洲'],
  ['KZ', '哈萨克斯坦', 'Kazakhstan', 'the Republic of Kazakhstan', 'hskst', '亚洲'],
  ['KE', '肯尼亚', 'Kenya', 'the Republic of Kenya', 'kny', '非洲'],
  ['KI', '基里巴斯', 'Kiribati', 'the Republic of Kiribati', 'jlbs', '大洋洲'],
  [
    'KP',
    '朝鲜',
    "Korea (the Democratic People's Republic of)",
    "the Democratic People's Republic of Korea",
    'cx',
    '亚洲',
  ],
  ['KR', '韩国', 'Korea', 'the Republic of Korea', 'hg', '亚洲'],
  ['KW', '科威特', 'Kuwait', 'the State of Kuwait', 'kwt', '亚洲'],
  ['KG', '吉尔吉斯斯坦', 'Kyrgyzstan', 'the Kyrgyz Republic', 'jejsst', '亚洲'],
  ['LA', '老挝', 'Lao', "the Lao People's Democratic Republic", 'lg', '亚洲'],
  ['LV', '拉脱维亚', 'Latvia', 'the Republic of Latvia', 'ltwy', '欧洲'],
  ['LB', '黎巴嫩', 'Lebanon', 'the Lebanese Republic', 'lbn', '亚洲'],
  ['LS', '莱索托', 'Lesotho', 'the Kingdom of Lesotho', 'lst', '非洲'],
  ['LR', '利比里亚', 'Liberia', 'the Republic of Liberia', 'lbly', '非洲'],
  [
    'LY',
    '利比亚',
    'Libyan Arab Jamahiriya',
    "the Socialist People's Libyan Arab Jamahiriya",
    'lby',
    '非洲',
  ],
  ['LI', '列支敦士登', 'Liechtenstein', 'the Principality of Liechtenstein', 'lzdsd', '欧洲'],
  ['LT', '立陶宛', 'Lithuania', 'the Republic of Lithuania', 'ltw', '欧洲'],
  ['LU', '卢森堡', 'Luxembourg', 'the Grand Duchy of Luxembourg', 'lsb', '欧洲'],
  ['MO', '澳门(中国)', 'Macao', 'Macao Special Administrative Region of China', 'amzg', '亚洲'],
  ['MK', '前南马其顿', 'Macedonia', 'the former Yugoslav Republic of Macedonia', 'qnmqd', '欧洲'],
  ['MG', '马达加斯加', 'Madagascar', 'the Republic of Madagascar', 'mdjsj', '非洲'],
  ['MW', '马拉维', 'Malawi', 'the Republic of Malawi', 'mlw', '非洲'],
  ['MY', '马来西亚', 'Malaysia', 'Malaysia', 'mlxy', '亚洲'],
  ['MV', '马尔代夫', 'Maldives', 'the Republic of Maldives', 'medf', '亚洲'],
  ['ML', '马里', 'Mali', 'the Republic of Mali', 'ml', '非洲'],
  ['MT', '马耳他', 'Malta', 'the Republic of Malta', 'met', '欧洲'],
  ['MH', '马绍尔群岛', 'Marshall Islands', 'the Republic of the Marshall Islands', 'mseqd', '亚洲'],
  ['MQ', '马提尼克', 'Martinique', 'Martinique', 'mtnk', '北美洲'],
  ['MR', '毛里塔尼亚', 'Mauritania', 'the Islamic Republic of Mauritania', 'mltny', '非洲'],
  ['MU', '毛里求斯', 'Mauritius', 'the Republic of Mauritius', 'mlqs', '非洲'],
  ['YT', '马约特', 'Mayotte', 'Mayotte', 'myt', '非洲'],
  ['MX', '墨西哥', 'Mexico', 'the United Mexican States', 'mxg', '北美洲'],
  [
    'FM',
    '密克罗尼西亚联邦',
    'Micronesia (the Federated States of)',
    'the Federated States of Micronesia',
    'mklnxylb',
    '大洋洲',
  ],
  ['MD', '摩尔多瓦', 'Moldova', 'the Republic of Moldova', 'medw', '欧洲'],
  ['MC', '摩纳哥', 'Monaco', 'the Principality of Monaco', 'mng', '欧洲'],
  ['MN', '蒙古', 'Mongolia', 'Mongolia', 'mg', '亚洲'],
  ['ME', '黑山', 'Montenegro', 'the Republic of Montenegro', 'hs', '欧洲'],
  ['MS', '蒙特塞拉特', 'Montserrat', 'Montserrat', 'mtslt', '北美洲'],
  ['MA', '摩洛哥', 'Morocco', 'the Kingdom of Morocco', 'mlg', '非洲'],
  ['MZ', '莫桑比克', 'Mozambique', 'the Republic of Mozambique', 'msbk', '非洲'],
  ['MM', '缅甸', 'Myanmar', 'the Union of Myanmar', 'md', '亚洲'],
  ['NA', '纳米比亚', 'Namibia', 'the Republic of Namibia', 'nmby', '非洲'],
  ['NR', '瑙鲁', 'Nauru', 'the Republic of Nauru', 'nl', '大洋洲'],
  ['NP', '尼泊尔', 'Nepal', 'Nepal', 'nbe', '亚洲'],
  ['NL', '荷兰', 'Netherlands', 'the Kingdom of the Netherlands', 'hl', '欧洲'],
  ['AN', '荷属安的列斯', 'Netherlands Antilles', 'Netherlands Antilles', 'hsadls', '北美洲'],
  ['NC', '新喀里多尼亚', 'New Caledonia', 'New Caledonia', 'xkldny', '大洋洲'],
  ['NZ', '新西兰', 'New Zealand', 'New Zealand', 'xxl', '大洋洲'],
  ['NI', '尼加拉瓜', 'Nicaragua', 'the Republic of Nicaragua', 'njlg', '北美洲'],
  ['NE', '尼日尔', 'Niger', 'the Republic of the Niger', 'nre', '非洲'],
  ['NG', '尼日利亚', 'Nigeria', 'the Federal Republic of Nigeria', 'nrly', '非洲'],
  ['NU', '纽埃', 'Niue', 'the Republic of Niue', 'na', '大洋洲'],
  ['NF', '诺福克岛', 'Norfolk Island', 'Norfolk Island', 'nfkd', '大洋洲'],
  [
    'MP',
    '北马里亚纳',
    'Northern Mariana Islands',
    'the Commonwealth of the Northern Mariana Islands',
    'bmlyn',
    '北美洲',
  ],
  ['NO', '挪威', 'Norway', 'the Kingdom of Norway', 'nw', '欧洲'],
  ['OM', '阿曼', 'Oman', 'the Sultanate of Oman', 'am', '亚洲'],
  ['PK', '巴基斯坦', 'Pakistan', 'the Islamic Republic of Pakistan', 'bjst', '亚洲'],
  ['PW', '帕劳', 'Palau', 'the Republic of Palau', 'pl', '大洋洲'],
  ['PS', '巴勒斯坦', 'Palestinian Territory', 'the Occupied Palestinian Territory', 'blst', '亚洲'],
  ['PA', '巴拿马', 'Panama', 'the Republic of Panama', 'bnm', '北美洲'],
  ['PG', '巴布亚新几内亚', 'Papua New Guinea', 'Papua New Guinea', 'bbyxjny', '大洋洲'],
  ['PY', '巴拉圭', 'Paraguay', 'the Republic of Paraguay', 'blg', '南美洲'],
  ['PE', '秘鲁', 'Peru', 'the Republic of Peru', 'ml', '南美洲'],
  ['PH', '菲律宾', 'Philippines', 'the Republic of the Philippines', 'flb', '亚洲'],
  ['PN', '皮特凯恩', 'Pitcairn', 'Pitcairn', 'ptke', '大洋洲'],
  ['PL', '波兰', 'Poland', 'the Republic of Poland', 'bl', '欧洲'],
  ['PT', '葡萄牙', 'Portugal', 'the Portuguese Republic', 'pty', '欧洲'],
  ['PR', '波多黎各', 'Puerto Rico', 'Puerto Rico', 'bdlg', '北美洲'],
  ['QA', '卡塔尔', 'Qatar', 'the State of Qatar', 'kte', '亚洲'],
  ['RE', '留尼汪', 'Réunion', 'Réunion', 'lnw', '非洲'],
  ['RO', '罗马尼亚', 'Romania', 'Romania', 'lmny', '欧洲'],
  ['RU', '俄罗斯', 'Russia', 'the Russian Federation', 'els', '欧洲'],
  ['RW', '卢旺达', 'Rwanda', 'the Republic of Rwanda', 'lwd', '非洲'],
  ['SH', '圣赫勒拿', 'Saint Helena', 'Saint Helena', 'shln', '非洲'],
  ['KN', '圣基茨和尼维斯', 'Saint Kitts and Nevis', 'Saint Kitts and Nevis', 'sjchnws', '北美洲'],
  ['LC', '圣卢西亚', 'Saint Lucia', 'Saint Lucia', 'slxy', '北美洲'],
  [
    'PM',
    '圣皮埃尔和密克隆',
    'Saint Pierre and Miquelon',
    'Saint Pierre and Miquelon',
    'spaehmkl',
    '北美洲',
  ],
  [
    'VC',
    '圣文森特和格林纳丁斯',
    'Saint Vincent and the Grenadines',
    'Saint Vincent and the Grenadines',
    'swsthglnds',
    '北美洲',
  ],
  ['WS', '萨摩亚', 'Samoa', 'the Independent State of Samoa', 'smy', '大洋洲'],
  ['SM', '圣马力诺', 'San Marino', 'the Republic of San Marino', 'smln', '欧洲'],
  [
    'ST',
    '圣多美和普林西比',
    'Sao Tome and Principe',
    'the Democratic Republic of Sao Tome and Principe',
    'sdmhplxb',
    '非洲',
  ],
  ['SA', '沙特阿拉伯', 'Saudi Arabia', 'the Kingdom of Saudi Arabia', 'stalb', '亚洲'],
  ['SN', '塞内加尔', 'Senegal', 'the Republic of Senegal', 'snje', '非洲'],
  ['RS', '塞尔维亚', 'Serbia', 'the Republic of Serbia', 'sewy', '欧洲'],
  ['XK', '科索沃', 'Kosovo', 'Kosovo', 'ksw', '欧洲'],
  ['SC', '塞舌尔', 'Seychelles', 'the Republic of Seychelles', 'sse', '非洲'],
  ['SL', '塞拉利昂', 'Sierra Leone', 'the Republic of Sierra Leone', 'slla', '非洲'],
  ['SG', '新加坡', 'Singapore', 'the Republic of Singapore', 'xjp', '亚洲'],
  ['SK', '斯洛伐克', 'Slovakia', 'the Slovak Republic', 'slfk', '欧洲'],
  ['SI', '斯洛文尼亚', 'Slovenia', 'the Republic of Slovenia', 'slwny', '欧洲'],
  ['SB', '所罗门群岛', 'Solomon Islands', 'Solomon Islands', 'slmqd', '大洋洲'],
  ['SO', '索马里', 'Somalia', 'the Somali Republic', 'sml', '非洲'],
  ['ZA', '南非', 'South Africa', 'the Republic of South Africa', 'nf', '非洲'],
  [
    'GS',
    '南乔治亚岛和南桑德韦奇岛',
    'South Georgia and the South Sandwich Islands',
    'South Georgia and the South Sandwich Islands',
    'nqzydhnsdwqd',
    '大洋洲',
  ],
  ['ES', '西班牙', 'Spain', 'the Kingdom of Spain', 'xby', '欧洲'],
  ['LK', '斯里兰卡', 'Sri Lanka', 'the Democratic Socialist Republic of Sri Lanka', 'sllk', '亚洲'],
  ['SD', '苏丹', 'Sudan', 'the Republic of the Sudan', 'sd', '非洲'],
  ['SR', '苏里南', 'Suriname', 'the Republic of Suriname', 'sln', '南美洲'],
  [
    'SJ',
    '斯瓦尔巴岛和扬马延岛',
    'Svalbard and Jan Mayen',
    'Svalbard and Jan Mayen',
    'swebdhymyd',
    '欧洲',
  ],
  ['SZ', '斯威士兰', 'Swaziland', 'the Kingdom of Swaziland', 'swsl', '非洲'],
  ['SE', '瑞典', 'Sweden', 'the Kingdom of Sweden', 'rd', '欧洲'],
  ['CH', '瑞士', 'Switzerland', 'the Swiss Confederation', 'rs', '欧洲'],
  ['SY', '叙利亚', 'Syrian', 'the Syrian Arab Republic', 'xly', '亚洲'],
  ['TW', '台湾(中国)', 'Taiwan', 'Taiwan (Province of China)', 'twzg', '亚洲'],
  ['TJ', '塔吉克斯坦', 'Tajikistan', 'the Republic of Tajikistan', 'tjkst', '亚洲'],
  ['TZ', '坦桑尼亚', 'Tanzania', 'the United Republic of Tanzania', 'tsny', '非洲'],
  ['TH', '泰国', 'Thailand', 'the Kingdom of Thailand', 'tg', '亚洲'],
  ['TL', '东帝汶', 'Timor-Leste', 'the Democratic Republic of Timor-Leste', 'ddw', '亚洲'],
  ['TG', '多哥', 'Togo', 'the Togolese Republic', 'dg', '非洲'],
  ['TK', '托克劳', 'Tokelau', 'Tokelau', 'tkl', '大洋洲'],
  ['TO', '汤加', 'Tonga', 'the Kingdom of Tonga', 'tj', '大洋洲'],
  [
    'TT',
    '特立尼达和多巴哥',
    'Trinidad and Tobago',
    'the Republic of Trinidad and Tobago',
    'tlndhdbg',
    '北美洲',
  ],
  ['TN', '突尼斯', 'Tunisia', 'the Republic of Tunisia', 'tns', '非洲'],
  ['TR', '土耳其', 'Turkey', 'the Republic of Turkey', 'teq', '亚洲'],
  ['TM', '土库曼斯坦', 'Turkmenistan', 'Turkmenistan', 'tkmst', '亚洲'],
  [
    'TC',
    '特克斯和凯科斯群岛',
    'Turks and Caicos Islands',
    'Turks and Caicos Islands',
    'tkshkksqd',
    '北美洲',
  ],
  ['TV', '图瓦卢', 'Tuvalu', 'Tuvalu', 'twl', '大洋洲'],
  ['UG', '乌干达', 'Uganda', 'the Republic of Uganda', 'wgd', '非洲'],
  ['UA', '乌克兰', 'Ukraine', 'Ukraine', 'wkl', '欧洲'],
  ['AE', '阿联酋', 'United Arab Emirates', 'the United Arab Emirates', 'alq', '亚洲'],
  [
    'GB',
    '英国',
    'United Kingdom',
    'the United Kingdom of Great Britain and Northern Ireland',
    'yg',
    '欧洲',
  ],
  ['US', '美国', 'United States', 'the United States of America', 'mg', '北美洲'],
  [
    'UM',
    '美国本土外小岛屿',
    'United States Minor Outlying Islands',
    'United States Minor Outlying Islands',
    'mgbtwxdy',
    '北美洲',
  ],
  ['UY', '乌拉圭', 'Uruguay', 'the Eastern Republic of Uruguay', 'wlg', '南美洲'],
  ['UZ', '乌兹别克斯坦', 'Uzbekistan', 'the Republic of Uzbekistan', 'wzbkst', '亚洲'],
  ['VU', '瓦努阿图', 'Vanuatu', 'the Republic of Vanuatu', 'wnat', '大洋洲'],
  ['VE', '委内瑞拉', 'Venezuela', 'the Bolivarian Republic of Venezuela', 'wnrl', '南美洲'],
  ['VN', '越南', 'Vietnam', 'the Socialist Republic of VietNam', 'yn', '亚洲'],
  [
    'VG',
    '英属维尔京群岛',
    'Virgin Islands (British)',
    'British Virgin Islands',
    'yswejqd',
    '北美洲',
  ],
  [
    'VI',
    '美属维尔京群岛',
    'Virgin Islands (U.S.)',
    'the Virgin Islands of the United States',
    'mswejqd',
    '北美洲',
  ],
  ['WF', '瓦利斯和富图纳', 'Wallis and Futuna', 'Wallis and Futuna Islands', 'wlshftn', '大洋洲'],
  ['EH', '西撒哈拉', 'Western Sahara', 'Western Sahara', 'xshl', '非洲'],
  ['YE', '也门', 'Yemen', 'the Republic of Yemen', 'ym', '亚洲'],
  ['ZM', '赞比亚', 'Zambia', 'the Republic of Zambia', 'zby', '非洲'],
  ['ZW', '津巴布韦', 'Zimbabwe', 'the Republic of Zimbabwe', 'jbbw', '非洲'],
];

export const COUNTRIES: readonly Country[] = ROWS.map(([abb2, cn, en, full, py, continent]) => ({
  abb2,
  cn,
  en,
  full,
  py,
  continent: continent as Continent,
}));

/**
 * alpha-2 → 国家。模块级建一次。
 * 旧项目三处 `CountriesData.filter(i => i.abb2 === code)[0]` 逐字复制,
 * 取不到时返回 undefined 再点属性就 TypeError —— 反查一律走这张表。
 */
export const countryByCode: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((c) => [c.abb2, c]),
);

/**
 * 反查,查不到直接抛。给**构造数据的地方**用(mock、种子数据、测试),
 * 目的是让写错的国家代码在启动时就炸,而不是在界面上渲染成一面白旗。
 * 业务代码不要用它 —— 后端哪天回一个新代码,页面不该整个崩掉,用 `countryByCode`。
 */
export function requireCountry(code: string): Country {
  const row = countryByCode.get(code);
  if (!row) throw new Error(`未知的国家代码:${code}`);
  return row;
}

/** 按洲分组,洲的顺序按 CONTINENTS,组内保持表内顺序(按英文名字母序) */
export function groupByContinent(list: readonly Country[] = COUNTRIES) {
  return CONTINENTS.map((continent) => ({
    continent,
    countries: list.filter((c) => c.continent === continent),
  })).filter((g) => g.countries.length > 0);
}
