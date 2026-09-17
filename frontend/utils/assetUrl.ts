export function normalizeAssetUrl(raw?: string | null) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value;
  if (value.startsWith('/api/uploads/') || value.startsWith('/api/prodImage/')) return value;
  if (value.startsWith('/uploads/') || value.startsWith('/prodImage/')) return `/api${value}`;
  return value.startsWith('/') ? value : `/${value}`;
}
