
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function buildProductKey({ categoryId, brand, sku, brandOrGroup, name, size }) {
  const prefix = slugify(categoryId || brand || "catalog");
  if (sku) return slugify(`${prefix}|sku|${sku}`);

  return slugify([
    prefix,
    slugify(brandOrGroup || ""),
    slugify(name || ""),
    slugify(size || "")
  ].join("|"));
}

function parseNumber(v) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  const lowered = s.toLowerCase();
  if (lowered.includes("по запросу")) return undefined;

  // remove spaces, nbsp, currency symbols
  let cleaned = s
    .replace(/\s/g, " ")
    .replace(/[₸$€]/g, "")
    .replace(/\s+/g, "");

  // A comma can mean either a thousands separator ("153,400" = 153400) or a
  // decimal point ("12,50" = 12.5), depending on the source file's locale.
  // Pure thousands-grouping (every comma-separated group after the first is
  // exactly 3 digits, with no other comma/dot in the string) is unambiguous -
  // strip those commas instead of treating them as a decimal point.
  cleaned = /^\d{1,3}(,\d{3})+$/.test(cleaned)
    ? cleaned.replace(/,/g, "")
    : cleaned.replace(/,/g, ".");

  const n = Number(cleaned);
  if (Number.isFinite(n)) return n;
  return undefined;
}

function isRowEmpty(row) {
  return !row || row.every((c) => String(c || "").trim() === "");
}

function rowNonEmptyCount(row) {
  if (!row) return 0;
  return row.reduce((acc, c) => acc + (String(c || "").trim() ? 1 : 0), 0);
}

function normalizeImageUrl(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("data:") || v.startsWith("blob:")) return v;
  if (v.startsWith("/api/uploads/") || v.startsWith("/api/prodImage/")) return v;
  if (v.startsWith("/uploads/") || v.startsWith("/prodImage/")) return `/api${v}`;
  return v.startsWith("/") ? v : `/${v}`;
}

function normalizeSiteSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const homepageImages = src.homepageImages && typeof src.homepageImages === "object"
    ? src.homepageImages
    : {};

  return {
    ...src,
    heroSlides: Array.isArray(src.heroSlides)
      ? src.heroSlides.map((slide) => ({
          ...slide,
          img: normalizeImageUrl(slide && slide.img)
        }))
      : [],
    aboutSlides: Array.isArray(src.aboutSlides)
      ? src.aboutSlides.map((slide) => ({
          ...slide,
          imageUrl: normalizeImageUrl(slide && slide.imageUrl),
          bullets: Array.isArray(slide && slide.bullets)
            ? slide.bullets.map((item) => String(item || "").trim()).filter(Boolean)
            : []
        }))
      : [],
    homepageImages: {
      ...homepageImages,
      headerLogo: normalizeImageUrl(homepageImages.headerLogo),
      footerLogo: normalizeImageUrl(homepageImages.footerLogo),
      partnersBackground: normalizeImageUrl(homepageImages.partnersBackground),
      productSlides: Array.isArray(homepageImages.productSlides)
        ? homepageImages.productSlides
            .map((item) => ({
              id: String(item && item.id ? item.id : "").trim(),
              title: String(item && item.title ? item.title : "").trim(),
              description: String(item && item.description ? item.description : "").trim(),
              image: normalizeImageUrl(item && item.image)
            }))
            .filter((item) => item.id)
        : [],
      partnerLogos: Array.isArray(homepageImages.partnerLogos)
        ? homepageImages.partnerLogos.map((item) => normalizeImageUrl(item)).filter(Boolean)
        : []
    },
    colorSwatches: Array.isArray(src.colorSwatches)
      ? src.colorSwatches
          .map((item) => ({
            code: String(item && item.code ? item.code : "").trim(),
            title: String(item && item.title ? item.title : "").trim(),
            image: normalizeImageUrl(item && item.image)
          }))
          .filter((item) => item.code || item.title)
      : []
  };
}

module.exports = {
  slugify,
  parseNumber,
  isRowEmpty,
  rowNonEmptyCount,
  buildProductKey,
  normalizeImageUrl,
  normalizeSiteSettings
};
