/**
 * Fill in missing Product.description from the structured data we already
 * have (name, brand, collection, attrs, sku).
 *
 * Why: 2201 of 2613 active products carry no description at all. Even with
 * the SEO renderer in place, those product pages have no unique prose for a
 * search engine to match a query against — the only text is the name, which
 * up to 17 sibling variants share. This writes real sentences built from each
 * product's own attributes, so the text differs wherever the products differ.
 *
 * The output is stored on the document rather than generated at render time
 * so that users see it too, the owner can edit it in the admin, and the SSR
 * and client renderers cannot disagree about it.
 *
 * Usage (from backend/):
 *   node scripts/generate-descriptions.js              # dry run, prints samples
 *   node scripts/generate-descriptions.js --apply      # writes, after a backup
 *   node scripts/generate-descriptions.js --apply --overwrite   # also replaces existing text
 *
 * A backup of every document it is about to touch is written to
 * backups/descriptions-before-<stamp>.json first, so the change can be undone.
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Product = require("../src/models/Product");

const APPLY = process.argv.includes("--apply");
const OVERWRITE = process.argv.includes("--overwrite");

const SALON = "салоне Bathroom Design в Астане, ул. Розы Баглановой, 2";

/** Case-insensitive attr lookup — suppliers mix "Цвет"/"color"/"ЦВЕТ". */
function attr(p, ...keys) {
  const entries = Object.entries(p.attrs || {});
  for (const key of keys) {
    const hit = entries.find(([k]) => k.trim().toLowerCase() === key.toLowerCase());
    const v = hit ? String(hit[1] ?? "").trim() : "";
    if (v) return v;
  }
  return "";
}

const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Stable per-product pick, so the openers vary across the catalog but a
 *  given product keeps the same wording between runs. */
function pick(list, seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

const OPENERS = [
  (n, b) => `${n}${b ? ` — ${b}` : ""}.`,
  (n, b) => `${n}${b ? ` от ${b}` : ""}.`,
  (n, b) => `${n}${b ? ` производства ${b}` : ""}.`
];

function buildDescription(p) {
  const name = String(p.name || "").trim();
  if (!name) return "";

  const brand = String(p.brand || "").trim();
  const collection = String(p.collection || attr(p, "Коллекция")).trim();
  const sentences = [];

  sentences.push(pick(OPENERS, p._id)(name, brand));

  if (collection) sentences.push(`Коллекция ${collection}.`);

  // Material / finish
  const material = attr(p, "Материал");
  const surface = attr(p, "Поверхность");
  const design = attr(p, "Дизайн", "Форма", "Линии форм");
  const build = [];
  if (material) build.push(`материал — ${lower(material)}`);
  if (surface) build.push(`поверхность ${lower(surface)}`);
  if (design) build.push(`дизайн ${lower(design)}`);
  if (build.length) sentences.push(`${build.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);

  // Colour
  const color = attr(p, "Название цвета", "Цвет", "color");
  if (color) sentences.push(`Цвет — ${lower(color)}.`);

  // Mounting / intended use
  const install = attr(p, "Установка", "Монтаж", "Тип установки");
  const purpose = attr(p, "Назначение");
  const control = attr(p, "Управление");
  const usage = [];
  if (install) usage.push(`установка — ${lower(install)}`);
  if (purpose) usage.push(`назначение — ${lower(purpose)}`);
  if (control) usage.push(`управление — ${lower(control)}`);
  if (usage.length) sentences.push(`${usage.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);

  // Dimensions
  const w = attr(p, "Ширина");
  const d = attr(p, "Глубина");
  const h = attr(p, "Высота");
  const dims = [w && `ширина ${w}`, d && `глубина ${d}`, h && `высота ${h}`].filter(Boolean);
  if (dims.length) sentences.push(`Размеры: ${dims.join(", ")} мм.`);

  if (p.sku) sentences.push(`Артикул ${String(p.sku).trim()}.`);

  sentences.push(`В наличии в ${SALON}. Консультация по подбору и доставка по Казахстану.`);

  return sentences.join(" ").replace(/\s+/g, " ").trim();
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);

  const filter = OVERWRITE ? { active: true } : { active: true, $or: [{ description: "" }, { description: { $exists: false } }] };
  const products = await Product.find(filter).lean();

  const updates = [];
  for (const p of products) {
    const description = buildDescription(p);
    // A bare "Name. В наличии…" adds nothing a crawler can use; skip products
    // with no attributes at all rather than writing filler.
    if (!description || description.split(" ").length < 14) continue;
    if (String(p.description || "").trim() === description) continue;
    updates.push({ _id: p._id, name: p.name, before: p.description || "", after: description });
  }

  console.log(`matched: ${products.length}`);
  console.log(`would update: ${updates.length}`);
  console.log(`skipped (too little data): ${products.length - updates.length}`);
  console.log("\n--- samples ---");
  for (const u of updates.slice(0, 4)) console.log(`\n[${u.name}]\n${u.after}`);
  const lengths = updates.map((u) => u.after.length).sort((a, b) => a - b);
  if (lengths.length) {
    console.log(
      `\nlength: min ${lengths[0]}, median ${lengths[Math.floor(lengths.length / 2)]}, max ${lengths[lengths.length - 1]}`
    );
    console.log(`distinct texts: ${new Set(updates.map((u) => u.after)).size} / ${updates.length}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const backupDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupDir, `descriptions-before-${stamp}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify(updates.map(({ _id, before }) => ({ _id: String(_id), description: before })), null, 1)
  );
  console.log(`\nbackup: ${backupFile}`);

  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const ops = updates.slice(i, i + BATCH).map((u) => ({
      updateOne: { filter: { _id: u._id }, update: { $set: { description: u.after } } }
    }));
    const res = await Product.bulkWrite(ops);
    console.log(`  wrote ${Math.min(i + BATCH, updates.length)}/${updates.length} (modified ${res.modifiedCount})`);
  }

  await mongoose.disconnect();
  console.log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
