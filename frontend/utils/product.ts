import { Product } from '../types';
import { normalizeAssetUrl } from './assetUrl';

export const formatPrice = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

/** Price shown on cards and the product page — falls back to the free-text note. */
export const displayPrice = (product: Pick<Product, 'prices'>) =>
  product.prices?.retail ? formatPrice(product.prices.retail) : product.prices?.note || 'По запросу';

// Suppliers mix marketing infographics, box shots and dimension drawings into
// the same image list, sometimes first: Raglo leads with "…-utp.jpg" (a poster
// of red badges and sales copy), Allen Brau with "…-komplekt.jpg". Matched on
// the filename only and token-delimited — a bare /size/ would also hit the
// "resized" directory every one of these URLs sits in.
const NON_PHOTO_IMAGE =
  /(?:^|[-_.])(scheme|sheme|chertezh|chert|drawing|razmer|dimensions|utp|kit|komplekt|montazh|instrukc|manual|infografika|banner)(?:[-_.]|\d|$)/i;

const isNonPhoto = (url: string) => NON_PHOTO_IMAGE.test(url.split('?')[0].split('/').pop() || '');

/**
 * All usable images for a product, de-duplicated, `image` last as a fallback.
 *
 * Diagrams and marketing posters are pushed to the back rather than dropped —
 * a couple of products have nothing else, and an infographic still beats an
 * empty frame.
 */
export const getProductImages = (product: Pick<Product, 'images' | 'image'>) => {
  const list = [...(Array.isArray(product.images) ? product.images : []), product.image || '']
    .map((item) => normalizeAssetUrl(item))
    .filter(Boolean);
  const unique = Array.from(new Set(list));
  const photos = unique.filter((url) => !isNonPhoto(url));
  return photos.length > 0 ? [...photos, ...unique.filter(isNonPhoto)] : unique;
};

export const normalizeAttrEntries = (attrs: Record<string, any> = {}) =>
  Object.entries(attrs || {})
    .map(([k, v]) => [String(k || ''), String(v ?? '').trim()] as const)
    .filter(([, v]) => Boolean(v));

// The catalog spells the same value inconsistently ("Черный матовый" vs
// "Черный Матовый"), which otherwise surfaces as two separate checkboxes that
// each match only part of the products. Group and compare on this form.
export const normalizeValue = (value: string) => value.trim().toLowerCase().replace(/ё/g, 'е');

/** Collapses spelling variants to the one used by the most products. */
export const dedupeByNormalized = (values: string[]) => {
  const groups = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = normalizeValue(value);
    const variants = groups.get(key) || new Map<string, number>();
    variants.set(value, (variants.get(value) || 0) + 1);
    groups.set(key, variants);
  }
  return Array.from(groups.values())
    .map((variants) => Array.from(variants.entries()).sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b, 'ru'));
};

export const getProductColor = (product: Pick<Product, 'attrs'>) => {
  const match = normalizeAttrEntries(product?.attrs || {}).find(([k]) => /^(color|цвет)$/i.test(k.trim()));
  return match ? match[1] : '';
};

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Suppliers encode the finish as the last SKU segment: Raglo "R20.10.08",
// Allen Brau "6.21010-00" / "6.21011-BN". The separator is captured rather
// than dropped because Allen Brau reuses one numeric stem across unrelated
// products — "5.11001-00" is a душевая стойка, "5.11001.ID" a донный клапан.
const FINISH_SUFFIX = /([.\-_])[A-Za-z0-9]{2,3}$/;

/** The model name with its SKU and finish words taken out. */
const stripFinishTokens = (product: Pick<Product, 'name' | 'sku' | 'attrs'>) => {
  const sku = String(product.sku || '').trim();
  const stem = sku.replace(FINISH_SUFFIX, '');

  let base = ` ${product.name || ''} `;
  if (sku) base = base.replace(new RegExp(escapeRe(sku), 'gi'), ' ');
  // Sibling SKUs appear inside the name too ("…5.31A04-00 (с донным…)").
  if (stem) base = base.replace(new RegExp(`${escapeRe(stem)}[a-z0-9.\\-_]*`, 'gi'), ' ');
  const color = getProductColor(product);
  for (const word of color ? color.split(/\s+/) : []) {
    // The catalog spells "Чёрный" in the attribute and "черный" in the name
    // (and vice versa), so match ё and е interchangeably.
    const pattern = escapeRe(word).replace(/[её]/gi, '[её]');
    base = base.replace(new RegExp(`\\s${pattern}(?=\\s|$)`, 'gi'), ' ');
  }
  return base.replace(/\s+/g, ' ').replace(/\s+([),.])/g, '$1').trim();
};

/**
 * Display name for a finish family — the model without the finish word or the
 * SKU, so the heading doesn't read "…Raglo белый R20.10.08" directly above a
 * swatch row that already says "Белый". Falls back to the raw name if
 * stripping leaves nothing useful.
 */
export const productFamilyName = (product: Pick<Product, 'name' | 'sku' | 'attrs'>) => {
  const stripped = stripFinishTokens(product);
  return stripped.length >= 3 ? stripped : product.name;
};

/**
 * Key identifying "the same model in a different finish".
 *
 * Grouping on the product name fails for most of the catalog: brands like
 * Raglo and Allen Brau spell the finish *into* the name ("…Raglo белый
 * R20.10.08"), so every finish looks like its own model. Stripping the finish
 * back out is too lossy to key on — the colour attribute and the name disagree
 * often enough ("Золотой сатин" vs "…сатин золото") to drop a variant from its
 * own family. So where the SKU exposes a finish suffix that is the key, and
 * the name is only the fallback for products whose SKU has no such suffix.
 */
export const productFamilyKey = (product: Pick<Product, 'name' | 'brand' | 'sku' | 'attrs'>) => {
  const sku = String(product.sku || '').trim();
  const suffix = sku.match(FINISH_SUFFIX);
  if (suffix) return `${product.brand || ''}|${sku.replace(FINISH_SUFFIX, '')}${suffix[1]}`;
  return `${product.brand || ''}|name|${normalizeValue(product.name || '')}`;
};

/** Attribute entries worth showing as specs — the finish has its own UI. */
export const specEntries = (product: Pick<Product, 'attrs'>) =>
  normalizeAttrEntries(product.attrs).filter(([key]) => !/^(color|цвет|название цвета)$/i.test(key.trim()));

/** Canonical in-app link to a product page. */
export const productPath = (product: Pick<Product, 'id'>) => `/product/${encodeURIComponent(product.id)}`;

/** Discount percentage, or 0 when there's no meaningful old price. */
export const discountPercent = (product: Pick<Product, 'prices'>) => {
  const retail = product.prices?.retail || 0;
  const old = product.prices?.oldPrice || 0;
  if (!retail || !old || old <= retail) return 0;
  return Math.round(((old - retail) / old) * 100);
};
