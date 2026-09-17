/**
 * Kazakhstan phone helpers. Numbers here are always +7 followed by 10 digits,
 * and customers type them every possible way (8707…, 707…, +7 707…), so the
 * input formats as you type instead of rejecting what was typed.
 */

const digitsOf = (value: string) => String(value || '').replace(/\D/g, '');

/** Digits without the country code, max 10. */
function nationalDigits(value: string) {
  let digits = digitsOf(value);
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.startsWith('7')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** "+7 (707) 123-45-67", built progressively from whatever is typed so far. */
export function formatKzPhone(value: string) {
  const d = nationalDigits(value);
  if (d.length === 0) return value.trim() ? '+7 ' : '';

  let out = '+7 (' + d.slice(0, 3);
  if (d.length >= 3) out += ')';
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += '-' + d.slice(6, 8);
  if (d.length > 8) out += '-' + d.slice(8, 10);
  return out;
}

export const isValidKzPhone = (value: string) => nationalDigits(value).length === 10;

/** E.164-ish form for tel: links, WhatsApp and the backend. */
export const toPlainPhone = (value: string) => {
  const d = nationalDigits(value);
  return d.length === 10 ? `+7${d}` : '';
};

export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
