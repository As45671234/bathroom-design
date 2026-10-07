// Cached slug↔name registries for categories and brands.
//
// The SSR renderer runs on every HTML request, and the sitemap rebuilds on
// every crawl, so resolving "/catalog/smesiteli" must not mean a full
// collection scan each time. Both lists change only when the owner imports or
// edits products, so a short TTL is plenty; `invalidate()` lets admin writes
// drop it immediately instead of waiting the TTL out.

const Product = require("../models/Product");
const CategoryMeta = require("../models/CategoryMeta");
const { uniqueSlugger } = require("../utils/slug");

const TTL_MS = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;
let inFlight = null;

const ACTIVE = { active: true, inStock: true };

/** Brand identity ignoring case, spacing and punctuation, so "AQUANET" /
 *  "Aquanet" and "Villeroy&Boch" / "Villeroy & Boch" collapse to one. */
const brandKey = (name) => String(name).toLowerCase().replace(/[^0-9a-zа-яё]/gi, "");

const isAllCaps = (s) => s === s.toUpperCase() && /[A-ZА-ЯЁ]/.test(s);

/**
 * Suppliers spell the same brand several ways in the import files, and the
 * catalog stores whatever arrived: production had 'AQUANET' on 12 products
 * and 'Aquanet' on 2, 'Villeroy&Boch' on 20 and 'Villeroy & Boch' on 1.
 * Treated as distinct brands they produce two landing pages per brand, each
 * holding a slice of the range and competing with the other for the same
 * query — worse than having none.
 *
 * Merging happens here rather than by rewriting the documents because the
 * owner re-imports Excel regularly: a one-off cleanup would be undone by the
 * next import, this holds. `variants` carries every raw spelling so callers
 * can still match products exactly (the `brand` index stays usable via $in)
 * instead of running a regex over the collection.
 *
 * Display name: prefer a variant that is not shouted in all caps — a genuine
 * all-caps brand like GROHE has no mixed-case variant to lose to — then the
 * spelling used on the most products.
 */
function groupBrands(rows) {
  const groups = new Map();

  for (const row of rows) {
    const name = String(row._id || "").trim();
    const key = brandKey(name);
    if (!name || !key) continue;
    if (!groups.has(key)) groups.set(key, { variants: [], count: 0 });
    const group = groups.get(key);
    group.variants.push({ name, count: row.count });
    group.count += row.count;
  }

  return [...groups.values()]
    .map((group) => {
      const best = [...group.variants].sort((a, b) => {
        const aCaps = isAllCaps(a.name);
        const bCaps = isAllCaps(b.name);
        if (aCaps !== bCaps) return aCaps ? 1 : -1;
        return b.count - a.count;
      })[0];

      return {
        name: best.name,
        variants: group.variants.map((v) => v.name),
        count: group.count
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

async function build() {
  const [categoryRows, brandRows, metas] = await Promise.all([
    Product.aggregate([
      { $match: ACTIVE },
      { $group: { _id: "$category_id", title: { $first: "$category_title" }, count: { $sum: 1 } } }
    ]),
    Product.aggregate([
      { $match: { ...ACTIVE, brand: { $nin: ["", null] } } },
      { $group: { _id: "$brand", count: { $sum: 1 } } }
    ]),
    CategoryMeta.find({}).lean()
  ]);

  // CategoryMeta.title is an empty string for every row in this database —
  // the display title is derived from the products instead. Only override
  // when the owner has actually typed something in the admin.
  const metaByCat = new Map(metas.map((m) => [m.category_id, m]));

  const catSlug = uniqueSlugger();
  const categories = categoryRows
    .filter((c) => c._id)
    .map((c) => {
      const meta = metaByCat.get(c._id);
      const metaTitle = String(meta?.title || "").trim();
      return {
        category_id: c._id,
        title: metaTitle || c.title || c._id,
        count: c.count,
        seoTitle: String(meta?.seoTitle || "").trim(),
        seoDescription: String(meta?.seoDescription || "").trim()
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  for (const c of categories) c.slug = catSlug(c.title, c.category_id);

  const brandSlug = uniqueSlugger();
  const brands = groupBrands(brandRows);
  for (const b of brands) b.slug = brandSlug(b.name);

  return {
    categories,
    brands,
    categoryBySlug: new Map(categories.map((c) => [c.slug, c])),
    categoryById: new Map(categories.map((c) => [c.category_id, c])),
    brandBySlug: new Map(brands.map((b) => [b.slug, b]))
  };
}

async function getRegistry() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  // Concurrent crawler hits on a cold cache would otherwise each kick off
  // their own aggregation; share one build between them.
  if (!inFlight) {
    inFlight = build()
      .then((built) => {
        cache = built;
        cachedAt = Date.now();
        return built;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

function invalidate() {
  cache = null;
  cachedAt = 0;
}

module.exports = { getRegistry, invalidate };
