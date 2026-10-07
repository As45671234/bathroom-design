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
  const brands = brandRows
    .map((b) => ({ name: String(b._id).trim(), count: b.count }))
    .filter((b) => b.name)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
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
