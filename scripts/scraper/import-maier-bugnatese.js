// Runs the real backend import pipeline (workbookToProducts + the same
// upsert logic the admin panel's Excel import uses) directly against the
// Bugnatese/Maier .xlsx files already generated in ./out, so they land in
// the live catalog without a manual admin-panel upload.
const path = require('path');
const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND_DIR, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND_DIR, '.env') });
const mongoose = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
const fs = require('fs');
const { workbookToProducts } = require(path.join(BACKEND_DIR, 'src', 'services', 'excelImport'));
const Product = require(path.join(BACKEND_DIR, 'src', 'models', 'Product'));
const CategoryMeta = require(path.join(BACKEND_DIR, 'src', 'models', 'CategoryMeta'));

const productImagesDir = path.join(BACKEND_DIR, 'uploads', 'products');
fs.mkdirSync(productImagesDir, { recursive: true });

const OUT_DIR = path.join(__dirname, 'out');

// Mirrors admin.js's resolveImportTarget: reuse an existing category's own
// title if it already exists, otherwise fall back to the given title.
async function resolveImportTarget(categoryId, categoryTitle) {
  const meta = await CategoryMeta.findOne({ category_id: categoryId }).lean();
  if (meta) return { id: categoryId, title: String(meta.title || categoryId).trim() || categoryId };
  const product = await Product.findOne({ category_id: categoryId, active: true }).select('category_id category_title').lean();
  if (product) return { id: categoryId, title: String(product.category_title || categoryId) };
  return { id: categoryId, title: categoryTitle || categoryId };
}

// Mirrors admin.js's upsertImportedProducts exactly (same matching/merge
// logic used by a real admin-panel import).
async function upsertImportedProducts(items, target) {
  let inserted = 0, updated = 0, skipped = 0;

  const validItems = items.filter((it) => {
    const ok = !!(it && it.name && it.category_id && it.key);
    if (!ok) skipped++;
    return ok;
  });

  const keys = Array.from(new Set(validItems.map((it) => String(it.key)).filter(Boolean)));
  const skus = Array.from(new Set(validItems.map((it) => String(it.sku || '').trim()).filter(Boolean)));
  const names = Array.from(new Set(validItems.filter((it) => !String(it.sku || '').trim()).map((it) => String(it.name || '').trim()).filter(Boolean)));

  const orQueries = [];
  if (keys.length) orQueries.push({ key: { $in: keys } });
  if (skus.length) orQueries.push({ category_id: target.id, sku: { $in: skus } });
  if (names.length) orQueries.push({ category_id: target.id, name: { $in: names } });

  const existingDocs = orQueries.length ? await Product.find({ $or: orQueries }).lean() : [];

  const byKey = new Map(), bySku = new Map(), byNameGroup = new Map();
  for (const doc of existingDocs) {
    if (doc && doc.key) byKey.set(String(doc.key), doc);
    if (doc && doc.category_id && doc.sku) bySku.set(`${doc.category_id}|${String(doc.sku).trim()}`, doc);
    if (doc && doc.category_id && doc.name) {
      byNameGroup.set(`${doc.category_id}|${String(doc.name).trim()}|${String(doc.collection || '').trim()}`, doc);
    }
  }

  const operations = [];
  for (const it of validItems) {
    const skuKey = it.sku ? `${it.category_id}|${String(it.sku).trim()}` : '';
    const nameGroupKey = `${it.category_id}|${String(it.name).trim()}|${String(it.collection || '').trim()}`;
    const existing = byKey.get(String(it.key)) || (skuKey ? bySku.get(skuKey) : null) || byNameGroup.get(nameGroupKey) || null;

    if (!existing || !existing._id) {
      operations.push({ insertOne: { document: it } });
      inserted++;
      continue;
    }

    const mergedPrices = { ...(existing.prices || {}), ...(it.prices || {}) };
    const mergedAttrs = it.attrs || existing.attrs || {};
    const setPayload = {
      category_id: it.category_id,
      category_title: it.category_title,
      key: it.key || existing.key,
      name: it.name,
      brand: it.brand || existing.brand || '',
      collection: it.collection || existing.collection || '',
      subcategory: it.subcategory || existing.subcategory || '',
      unit: it.unit || existing.unit || 'шт',
      sku: it.sku || existing.sku || '',
      description: it.description || existing.description || '',
      attrs: mergedAttrs,
      prices: mergedPrices
    };
    if (it.image) setPayload.image = it.image;
    if (Array.isArray(it.images) && it.images.length) setPayload.images = it.images;

    operations.push({ updateOne: { filter: { _id: existing._id }, update: { $set: setPayload } } });
    updated++;
  }

  if (operations.length) await Product.bulkWrite(operations, { ordered: false });
  return { inserted, updated, skipped };
}

const PLAN = [
  { file: 'bugnatese-smesiteli-rakovina.xlsx', category: 'смесители', title: 'Смесители' },
  { file: 'bugnatese-gig-dush-bide.xlsx', category: 'смесители', title: 'Смесители' },
  { file: 'bugnatese-vanna-dush.xlsx', category: 'смесители', title: 'Смесители' },
  { file: 'maier-rakovina.xlsx', category: 'смесители', title: 'Смесители' },
  { file: 'maier-bide.xlsx', category: 'смесители', title: 'Смесители' },
  { file: 'maier-vstroennye.xlsx', category: 'смесители', title: 'Смесители' },
  { file: 'maier-gig-dush.xlsx', category: 'смесители', title: 'Смесители' },
  { file: 'maier-aksessuary.xlsx', category: 'аксессуары', title: 'Аксессуары' }
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let totals = { inserted: 0, updated: 0, skipped: 0 };

  for (const step of PLAN) {
    const filePath = path.join(OUT_DIR, step.file);
    const buffer = fs.readFileSync(filePath);
    const target = await resolveImportTarget(step.category, step.title);

    const items = await workbookToProducts({ buffer, filename: step.file, imagesDir: productImagesDir, target });
    const { inserted, updated, skipped } = await upsertImportedProducts(items, target);

    totals.inserted += inserted; totals.updated += updated; totals.skipped += skipped;
    console.log(`${step.file} -> категория "${target.title}": +${inserted} новых, ${updated} обновлено, ${skipped} пропущено (из ${items.length} строк)`);
  }

  console.log('\nИТОГО:', JSON.stringify(totals));
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
