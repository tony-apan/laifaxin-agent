import type { ContactRow, FieldItem } from './crm';

/** Basic contact fields use the same stored values as Web; other fields remain untouched. */
export const CUSTOMER_EDIT_KEYS = [
  'email',
  'first_name',
  'last_name',
  'mobile',
  'position',
  'remark',
  'c_id',
  'c_name',
] as const;
export type CustomerEditKey = (typeof CUSTOMER_EDIT_KEYS)[number];
export type CustomerForm = Record<CustomerEditKey, string>;
export const CUSTOMER_FIELD_LIMITS: Record<CustomerEditKey, number> = {
  email: 256,
  first_name: 256,
  last_name: 256,
  mobile: 128,
  position: 256,
  remark: 5000,
  c_id: 256,
  c_name: 500,
};
export function customerForm(row: ContactRow = {}): CustomerForm {
  return Object.fromEntries(
    CUSTOMER_EDIT_KEYS.map((key) => [key, contactText(row[key])]),
  ) as CustomerForm;
}
export function customerEditableKeys(fields: FieldItem[], row: ContactRow = {}): CustomerEditKey[] {
  return CUSTOMER_EDIT_KEYS.filter((key) => {
    const field = fields.find((f) => f.dataIndex === (key === 'c_name' ? 'c_id' : key));
    return field && field.editable !== false && (row[key] == null || typeof row[key] === 'string');
  });
}
/** Match Web's input validation; the API remains authoritative for accepted email formats. */
export const validCustomerEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export function customerFormError(form: CustomerForm, baseline?: ContactRow): string {
  const original = baseline ? customerForm(baseline) : undefined;
  if ((!original || form.email !== original.email) && !validCustomerEmail(form.email))
    return 'customers.emailInvalid';
  for (const key of CUSTOMER_EDIT_KEYS) {
    if (original && form[key] === original[key]) continue;
    if (form[key].length > CUSTOMER_FIELD_LIMITS[key]) return 'customers.fieldTooLong';
  }
  return '';
}
export function customerCreateBody(form: CustomerForm, editable: CustomerEditKey[]) {
  const error = customerFormError(form);
  if (error) throw new Error(error);
  if (!editable.includes('email')) throw new Error('customers.fieldsChanged');
  const body: Partial<CustomerForm> = {};
  for (const key of CUSTOMER_EDIT_KEYS) {
    if (!form[key]) continue;
    if (!editable.includes(key)) throw new Error('customers.fieldsChanged');
    body[key] = key === 'email' ? form[key].trim().toLowerCase() : form[key];
  }
  return body;
}
/** Only changed fields are sent. Treat company id/name as one atomic UI selection. */
export function customerUpdatePatch(
  baseline: ContactRow,
  form: CustomerForm,
  latest: ContactRow,
  editable: CustomerEditKey[],
): Partial<CustomerForm> {
  const error = customerFormError(form, baseline);
  if (error) throw new Error(error);
  const original = customerForm(baseline),
    remote = customerForm(latest);
  const patch: Partial<CustomerForm> = {};
  const companyChanged = form.c_id !== original.c_id || form.c_name !== original.c_name;
  for (const key of CUSTOMER_EDIT_KEYS) {
    const company = key === 'c_id' || key === 'c_name';
    if (company ? !companyChanged : form[key] === original[key]) continue;
    if (!editable.includes(key)) throw new Error('customers.fieldsChanged');
    const value = key === 'email' ? form[key].trim() : form[key];
    if (remote[key] !== original[key] && remote[key] !== value)
      throw new Error('customers.editConflict');
    patch[key] = value;
  }
  return patch;
}
export function customerMatches(row: ContactRow, expected: Partial<CustomerForm>) {
  return Object.entries(expected).every(([key, value]) => contactText(row[key]) === value);
}

export const CUSTOMER_PAGE_SIZE = 20;
export const FOLLOW_TEXT_LIMIT = 5000;
export const contactText = (value: unknown): string => (typeof value === 'string' ? value : '');
export function contactName(row: ContactRow): string {
  return (
    [row.first_name, row.last_name].map(contactText).filter(Boolean).join(' ').trim() ||
    contactText(row.name) ||
    contactText(row.email)
  );
}

/** Plain-text editors must never submit user input as executable HTML to Web. */
export function followTextToHtml(text: string): string {
  const escaped = text
    .trim()
    .replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
    );
  return `<p>${escaped.replace(/\r\n?|\n/g, '<br>')}</p>`;
}

export { displayHtmlToText as followHtmlToText } from './text';

export function dateInput(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Avoid UTC parsing and the iOS differences of Date.parse('YYYY-MM-DD'). */
export function followDateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 9);
  return dateInput(date.getTime()) === value ? date.getTime() : 0;
}
export function tomorrowInput(now = Date.now()): string {
  const d = new Date(now);
  return dateInput(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
}
