
const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");


const Product = require("../models/Product");
const CategoryMeta = require("../models/CategoryMeta");
const Order = require("../models/Order");
const Lead = require("../models/Lead");
const SiteSettings = require("../models/SiteSettings");
const Designer = require("../models/Designer");
const { requireAdmin } = require("../middleware/auth");
const { workbookToProducts, buildImportTemplateWorkbook } = require("../services/excelImport");
const { slugify, buildProductKey, normalizeImageUrl, normalizeSiteSettings } = require("../utils");

const router = express.Router();

const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, "..", "..", "uploads"));
const videoUploadMaxMb = Math.max(50, Number(process.env.VIDEO_UPLOAD_MAX_MB || 250));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }
});
const productImagesDir = path.join(uploadsRoot, "products");
fs.mkdirSync(productImagesDir, { recursive: true });
const categoryVideosDir = path.join(uploadsRoot, "category-videos");
fs.mkdirSync(categoryVideosDir, { recursive: true });
const importChunksDir = path.join(uploadsRoot, "import-chunks");
fs.mkdirSync(importChunksDir, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => {
      fs.mkdirSync(productImagesDir, { recursive: true });
      cb(null, productImagesDir);
    },
    filename: (_, file, cb) => {
      const ext = path.extname(String(file.originalname || "")).toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(ext) ? ext : ".jpg";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => {
      fs.mkdirSync(categoryVideosDir, { recursive: true });
      cb(null, categoryVideosDir);
    },
    filename: (_, file, cb) => {
      const ext = path.extname(String(file.originalname || "")).toLowerCase();
      const safeExt = [".mp4", ".webm", ".ogg"].includes(ext) ? ext : ".mp4";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: Math.floor(videoUploadMaxMb * 1024 * 1024) },
});

function uploadSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();

      // Multer errors are very common for big files; return a readable message.
      if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "file too large" });
      }

      return res.status(400).json({ error: "upload failed", details: String(err && err.message ? err.message : err) });
    });
  };
}

function makeUploadId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getChunkDir(uploadIdRaw) {
  const uploadId = String(uploadIdRaw || "").trim();
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(uploadId)) return "";
  return path.join(importChunksDir, uploadId);
}

function cleanupDirSafe(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (e) {
    // ignore cleanup failures
  }
}

function findDuplicateSkusInFile(items) {
  const skuMap = new Map();

  for (const it of items || []) {
    const skuRaw = String(it && it.sku ? it.sku : "").trim();
    if (!skuRaw) continue;

    const norm = skuRaw.toLowerCase();
    const prev = skuMap.get(norm);
    if (!prev) {
      skuMap.set(norm, { sku: skuRaw, count: 1 });
    } else {
      prev.count += 1;
    }
  }

  return Array.from(skuMap.values()).filter((x) => x.count > 1);
}

// Resolve which category an Excel import should land in: either an existing
// CategoryMeta entry, or an existing category that already has products, or
// a brand-new category_id/title picked in the admin UI.
async function resolveImportTarget(categoryValue, categoryTitleValue) {
  const categoryId = String(categoryValue || "").trim();
  if (!categoryId) return null;

  const meta = await CategoryMeta.findOne({ category_id: categoryId }).lean();
  if (meta) {
    return { id: categoryId, title: String(meta.title || categoryId).trim() || categoryId };
  }

  const product = await Product.findOne({ category_id: categoryId, active: true }).select("category_id category_title").lean();
  if (product) {
    return { id: categoryId, title: String(product.category_title || categoryId) };
  }

  const title = String(categoryTitleValue || categoryId).trim() || categoryId;
  return { id: categoryId, title };
}

async function upsertImportedProducts(items, target) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const validItems = items.filter((it) => {
    const ok = !!(it && it.name && it.category_id && it.key);
    if (!ok) skipped++;
    return ok;
  });

  const keys = Array.from(new Set(validItems.map((it) => String(it.key)).filter(Boolean)));
  const skus = Array.from(new Set(validItems.map((it) => String(it.sku || "").trim()).filter(Boolean)));
  const names = Array.from(new Set(validItems.filter((it) => !String(it.sku || "").trim()).map((it) => String(it.name || "").trim()).filter(Boolean)));

  const orQueries = [];
  if (keys.length) orQueries.push({ key: { $in: keys } });
  if (skus.length) orQueries.push({ category_id: target.id, sku: { $in: skus } });
  if (names.length) orQueries.push({ category_id: target.id, name: { $in: names } });

  const existingDocs = orQueries.length
    ? await Product.find({ $or: orQueries }).lean()
    : [];

  const byKey = new Map();
  const bySku = new Map();
  const byNameGroup = new Map();

  for (const doc of existingDocs) {
    if (doc && doc.key) byKey.set(String(doc.key), doc);
    if (doc && doc.category_id && doc.sku) bySku.set(`${doc.category_id}|${String(doc.sku).trim()}`, doc);
    if (doc && doc.category_id && doc.name) {
      const ng = `${doc.category_id}|${String(doc.name).trim()}|${String(doc.collection || "").trim()}`;
      byNameGroup.set(ng, doc);
    }
  }

  const operations = [];

  for (const it of validItems) {
    const skuKey = it.sku ? `${it.category_id}|${String(it.sku).trim()}` : "";
    const nameGroupKey = `${it.category_id}|${String(it.name).trim()}|${String(it.collection || "").trim()}`;

    const existing =
      byKey.get(String(it.key)) ||
      (skuKey ? bySku.get(skuKey) : null) ||
      byNameGroup.get(nameGroupKey) ||
      null;

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
      brand: it.brand || existing.brand || "",
      collection: it.collection || existing.collection || "",
      subcategory: it.subcategory || existing.subcategory || "",
      unit: it.unit || existing.unit || "шт",
      sku: it.sku || existing.sku || "",
      description: it.description || existing.description || "",
      attrs: mergedAttrs,
      prices: mergedPrices
    };

    if (it.image) setPayload.image = it.image;
    if (Array.isArray(it.images) && it.images.length) setPayload.images = it.images;
    if (it.stockQty !== undefined) {
      setPayload.stockQty = it.stockQty;
      setPayload.inStock = it.stockQty > 0;
    }

    operations.push({
      updateOne: {
        filter: { _id: existing._id },
        update: { $set: setPayload }
      }
    });
    updated++;
  }

  if (operations.length) {
    await Product.bulkWrite(operations, { ordered: false });
  }

  return { inserted, updated, skipped };
}


router.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "password required" });

  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected || password !== expected) return res.status(401).json({ error: "invalid password" });

  const token = jwt.sign(
    { role: "admin" },
    process.env.JWT_SECRET || "secret",
    { expiresIn: "7d" }
  );

  res.json({ token });
});

router.post("/purge-all", requireAdmin, async (req, res) => {
  const confirmText = String(req.body?.confirmText || "").trim();
  const purgePassword = String(req.body?.purgePassword || "").trim();

  if (confirmText !== "DELETE_ALL") {
    return res.status(400).json({ error: "invalid confirmation text" });
  }

  const expected = process.env.ADMIN_PURGE_PASSWORD || "";
  if (!expected || !purgePassword || purgePassword !== expected) {
    return res.status(403).json({ error: "invalid purge password" });
  }

  const [products, categories, orders, leads] = await Promise.all([
    Product.deleteMany({}),
    CategoryMeta.deleteMany({}),
    Order.deleteMany({}),
    Lead.deleteMany({})
  ]);

  return res.json({
    ok: true,
    deleted: {
      products: Number(products?.deletedCount || 0),
      categories: Number(categories?.deletedCount || 0),
      orders: Number(orders?.deletedCount || 0),
      leads: Number(leads?.deletedCount || 0)
    }
  });
});

router.get("/catalog", requireAdmin, async (req, res) => {
  const products = await Product.find({ active: true }).sort({ category_title: 1, name: 1 }).lean();
  const categoriesMap = new Map();

  for (const p of products) {
    const catId = p.category_id;
    if (!categoriesMap.has(catId)) {
      categoriesMap.set(catId, {
        id: catId,
        title: p.category_title,
        items: [],
        image: "",
        styleVariant: 1,
        videoUrl: "",
        seoTitle: "",
        seoDescription: "",
        seoKeywords: ""
      });
    }
    categoriesMap.get(catId).items.push({
      id: String(p._id),
      name: p.name,
      brand: p.brand || "",
      collection: p.collection || "",
      subcategory: p.subcategory || "",
      unit: p.unit || "шт",
      sku: p.sku || "",
      image: normalizeImageUrl(p.image),
      images: (Array.isArray(p.images) ? p.images : []).map((x) => normalizeImageUrl(x)).filter(Boolean),
      description: p.description || "",
      stockQty: p.stockQty,
      prices: p.prices || {},
      attrs: p.attrs || {},
      category_id: p.category_id,
      inStock: !!p.inStock
    });
  }

  const metas = await CategoryMeta.find({}).lean();
  const metaMap = new Map(metas.map((m) => [m.category_id, m]));

  for (const [id, cat] of categoriesMap.entries()) {
    const meta = metaMap.get(id);
    if (meta && meta.title) cat.title = String(meta.title || "").trim() || cat.title;
    if (meta && meta.image) cat.image = normalizeImageUrl(meta.image);
    if (meta && Number(meta.styleVariant) === 2) cat.styleVariant = 2;
    if (meta && meta.videoUrl) cat.videoUrl = String(meta.videoUrl || "").trim();
    if (meta) cat.seoTitle = String(meta.seoTitle || "").trim();
    if (meta) cat.seoDescription = String(meta.seoDescription || "").trim();
    if (meta) cat.seoKeywords = String(meta.seoKeywords || "").trim();
  }

  // Show meta-only categories too (even if they don't have products yet).
  for (const meta of metas) {
    const id = String(meta?.category_id || "").trim();
    if (!id || categoriesMap.has(id)) continue;
    categoriesMap.set(id, {
      id,
      title: String(meta?.title || id),
      items: [],
      image: normalizeImageUrl(meta?.image || ""),
      styleVariant: Number(meta?.styleVariant) === 2 ? 2 : 1,
      videoUrl: String(meta?.videoUrl || "").trim(),
      seoTitle: String(meta?.seoTitle || "").trim(),
      seoDescription: String(meta?.seoDescription || "").trim(),
      seoKeywords: String(meta?.seoKeywords || "").trim()
    });
  }

  const items = Array.from(categoriesMap.values()).sort((a, b) =>
    String(a.title || "").localeCompare(String(b.title || ""), "ru")
  );

  res.json({ categories: items });
});

router.get("/categories", requireAdmin, async (req, res) => {
  const products = await Product.find({ active: true }).select("category_id category_title").lean();
  const categoriesMap = new Map();

  for (const p of products) {
    const catId = p.category_id;
    if (!categoriesMap.has(catId)) {
      categoriesMap.set(catId, { id: catId, title: p.category_title, image: "", styleVariant: 1, videoUrl: "", seoTitle: "", seoDescription: "", seoKeywords: "", productsCount: 0 });
    }
    const cat = categoriesMap.get(catId);
    cat.productsCount = Number(cat.productsCount || 0) + 1;
  }

  const metas = await CategoryMeta.find({}).lean();
  const metaMap = new Map(metas.map((m) => [m.category_id, m]));

  for (const [id, cat] of categoriesMap.entries()) {
    const meta = metaMap.get(id);
    if (meta && meta.image) cat.image = normalizeImageUrl(meta.image);
    if (meta && meta.title) cat.title = String(meta.title || "").trim() || cat.title;
    if (meta && Number(meta.styleVariant) === 2) cat.styleVariant = 2;
    if (meta && meta.videoUrl) cat.videoUrl = String(meta.videoUrl || "").trim();
    if (meta) cat.seoTitle = String(meta.seoTitle || "").trim();
    if (meta) cat.seoDescription = String(meta.seoDescription || "").trim();
    if (meta) cat.seoKeywords = String(meta.seoKeywords || "").trim();
  }

  for (const meta of metas) {
    const id = String(meta?.category_id || "").trim();
    if (!id || categoriesMap.has(id)) continue;
    categoriesMap.set(id, {
      id,
      title: String(meta?.title || id),
      image: normalizeImageUrl(meta?.image || ""),
      styleVariant: Number(meta?.styleVariant) === 2 ? 2 : 1,
      videoUrl: String(meta?.videoUrl || "").trim(),
      seoTitle: String(meta?.seoTitle || "").trim(),
      seoDescription: String(meta?.seoDescription || "").trim(),
      seoKeywords: String(meta?.seoKeywords || "").trim(),
      productsCount: 0
    });
  }

  const items = Array.from(categoriesMap.values()).sort((a, b) =>
    String(a.title || "").localeCompare(String(b.title || ""), "ru")
  );

  res.json({ categories: items });
});

router.patch("/categories/:id", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "category id required" });

    const image = req.body?.image;
    const title = req.body?.title;
    const styleVariantRaw = req.body?.styleVariant;
    const videoUrl = req.body?.videoUrl;
    const seoTitle = req.body?.seoTitle;
    const seoDescription = req.body?.seoDescription;
    const seoKeywords = req.body?.seoKeywords;

    const update = { category_id: id };
    if (image !== undefined) update.image = String(image || "");
    if (title !== undefined) update.title = String(title || "");
    if (styleVariantRaw !== undefined) {
      update.styleVariant = Number(styleVariantRaw) === 2 ? 2 : 1;
    }
    if (videoUrl !== undefined) update.videoUrl = String(videoUrl || "").trim();
    if (seoTitle !== undefined) update.seoTitle = String(seoTitle || "").trim();
    if (seoDescription !== undefined) update.seoDescription = String(seoDescription || "").trim();
    if (seoKeywords !== undefined) update.seoKeywords = String(seoKeywords || "").trim();

    const saved = await CategoryMeta.findOneAndUpdate(
      { category_id: id },
      { $set: update },
      { upsert: true, new: true, returnDocument: "after" }
    ).lean();

    if (!saved) return res.status(500).json({ error: "failed to save category meta" });

    if (title !== undefined) {
      const normalizedTitle = String(title || "").trim();
      await Product.updateMany(
        { category_id: id },
        { $set: { category_title: normalizedTitle } }
      );
    }

    res.json({
      ok: true,
      category: {
        id: id,
        title: String(saved.title || ""),
        image: normalizeImageUrl(saved.image || ""),
        styleVariant: Number(saved.styleVariant) === 2 ? 2 : 1,
        videoUrl: String(saved.videoUrl || "").trim(),
        seoTitle: String(saved.seoTitle || "").trim(),
        seoDescription: String(saved.seoDescription || "").trim(),
        seoKeywords: String(saved.seoKeywords || "").trim()
      }
    });
  } catch (e) {
    console.error("PATCH /categories/:id error:", e);
    res.status(500).json({ error: "failed to save category meta", details: String(e && e.message ? e.message : e) });
  }
});

router.post("/categories", requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const incomingId = String(req.body?.id || "").trim();
  const id = incomingId || slugify(title) || String(Date.now());
  if (!title) return res.status(400).json({ error: "category title required" });

  const exists = await CategoryMeta.findOne({ category_id: id }).lean();
  if (exists) return res.status(409).json({ error: "category already exists" });

  const styleVariant = Number(req.body?.styleVariant) === 2 ? 2 : 1;
  const created = await CategoryMeta.create({
    category_id: id,
    title: title || id,
    image: String(req.body?.image || "").trim(),
    styleVariant,
    videoUrl: String(req.body?.videoUrl || "").trim(),
    seoTitle: String(req.body?.seoTitle || "").trim(),
    seoDescription: String(req.body?.seoDescription || "").trim(),
    seoKeywords: String(req.body?.seoKeywords || "").trim()
  });

  res.json({
    ok: true,
    category: {
      id: created.category_id,
      title: created.title || "",
      image: normalizeImageUrl(created.image),
      styleVariant: Number(created.styleVariant) === 2 ? 2 : 1,
      videoUrl: String(created.videoUrl || "").trim(),
      seoTitle: String(created.seoTitle || "").trim(),
      seoDescription: String(created.seoDescription || "").trim(),
      seoKeywords: String(created.seoKeywords || "").trim(),
      productsCount: 0
    }
  });
});

router.delete("/categories/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "category id required" });

  const removeProducts = String(req.query.removeProducts || "").toLowerCase() === "true";

  const [metaResult, productsResult] = await Promise.all([
    CategoryMeta.deleteOne({ category_id: id }),
    removeProducts ? Product.deleteMany({ category_id: id }) : Promise.resolve({ deletedCount: 0 })
  ]);

  res.json({
    ok: true,
    deleted: {
      categoryMeta: Number(metaResult?.deletedCount || 0),
      products: Number(productsResult?.deletedCount || 0)
    }
  });
});

router.get("/import/excel/template", requireAdmin, async (req, res) => {
  try {
    const buffer = await buildImportTemplateWorkbook();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"import-template.xlsx\"");
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ error: "template generation failed", details: String(e && e.message ? e.message : e) });
  }
});

router.post("/import/excel", requireAdmin, uploadSingle("file"), async (req, res) => {
  try {
    const t0 = Date.now();
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required" });
    const category = String(req.body?.category || "").trim();
    const categoryTitle = String(req.body?.categoryTitle || "").trim();
    const brand = String(req.body?.brand || "").trim();
    const target = await resolveImportTarget(category, categoryTitle);
    if (!target) {
      return res.status(400).json({ error: "category is required" });
    }
    // Single sheet name to restrict the import to (sheet names themselves may
    // contain commas, so this is one name per request rather than a CSV list).
    const sheetNameFilter = String(req.body?.sheetNames || "").trim();

    const items = await workbookToProducts({
      buffer: file.buffer,
      filename: file.originalname || "",
      imagesDir: productImagesDir,
      target,
      sheetNames: sheetNameFilter ? [sheetNameFilter] : undefined
    });
    if (brand) items.forEach((it) => { it.brand = brand; });

    if (!items.length) {
      return res.status(400).json({
        error: "excel template was not recognized",
        details: "Не удалось распознать строки товаров. Проверьте заголовки Excel и повторите импорт."
      });
    }

    const duplicateSkus = findDuplicateSkusInFile(items);
    if (duplicateSkus.length) {
      const details = duplicateSkus
        .map((d) => `${d.sku} (x${d.count})`)
        .join(", ");
      return res.status(400).json({
        error: "duplicate sku in file",
        details: `В Excel найдены повторяющиеся артикулы: ${details}. Удалите дубликаты и повторите импорт.`,
        duplicates: duplicateSkus
      });
    }

    const { inserted, updated, skipped } = await upsertImportedProducts(items, target);

    res.json({
      ok: true,
      inserted,
      updated,
      skipped,
      totalParsed: items.length,
      category: target,
      durationMs: Date.now() - t0
    });
  } catch (e) {
    res.status(500).json({ error: "import failed", details: String(e && e.message ? e.message : e) });
  }
});

router.post("/import/excel/chunk/init", requireAdmin, async (req, res) => {
  const uploadId = makeUploadId();
  const dir = getChunkDir(uploadId);
  if (!dir) return res.status(400).json({ error: "invalid upload id" });

  fs.mkdirSync(dir, { recursive: true });
  res.json({ ok: true, uploadId });
});

router.post("/import/excel/chunk/:uploadId", requireAdmin, uploadSingle("chunk"), async (req, res) => {
  const dir = getChunkDir(req.params.uploadId);
  if (!dir) return res.status(400).json({ error: "invalid upload id" });
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "upload session not found" });

  const file = req.file;
  if (!file) return res.status(400).json({ error: "chunk is required" });

  const idxRaw = String(req.body?.index || "").trim();
  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 0 || idx > 10000) {
    return res.status(400).json({ error: "invalid chunk index" });
  }

  const partPath = path.join(dir, `${idx}.part`);
  fs.writeFileSync(partPath, file.buffer);
  res.json({ ok: true, index: idx, size: file.size || file.buffer?.length || 0 });
});

router.post("/import/excel/chunk/:uploadId/complete", requireAdmin, async (req, res) => {
  const t0 = Date.now();
  const dir = getChunkDir(req.params.uploadId);
  if (!dir) return res.status(400).json({ error: "invalid upload id" });
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "upload session not found" });

  try {
    const category = String(req.body?.category || "").trim();
    const categoryTitle = String(req.body?.categoryTitle || "").trim();
    const brand = String(req.body?.brand || "").trim();
    const target = await resolveImportTarget(category, categoryTitle);
    if (!target) {
      return res.status(400).json({ error: "category is required" });
    }

    const filename = String(req.body?.filename || "import.xlsx");
    const parts = fs.readdirSync(dir)
      .filter((name) => /^\d+\.part$/.test(name))
      .map((name) => ({ name, idx: Number(name.replace(/\.part$/, "")) }))
      .sort((a, b) => a.idx - b.idx);

    if (!parts.length) {
      return res.status(400).json({ error: "no chunks uploaded" });
    }

    const buffers = parts.map((p) => fs.readFileSync(path.join(dir, p.name)));
    const merged = Buffer.concat(buffers);

    const items = await workbookToProducts({
      buffer: merged,
      filename,
      imagesDir: productImagesDir,
      target
    });
    if (brand) items.forEach((it) => { it.brand = brand; });

    if (!items.length) {
      return res.status(400).json({
        error: "excel template was not recognized",
        details: "Не удалось распознать строки товаров. Проверьте заголовки Excel и повторите импорт."
      });
    }

    const duplicateSkus = findDuplicateSkusInFile(items);
    if (duplicateSkus.length) {
      const details = duplicateSkus
        .map((d) => `${d.sku} (x${d.count})`)
        .join(", ");
      return res.status(400).json({
        error: "duplicate sku in file",
        details: `В Excel найдены повторяющиеся артикулы: ${details}. Удалите дубликаты и повторите импорт.`,
        duplicates: duplicateSkus
      });
    }

    const { inserted, updated, skipped } = await upsertImportedProducts(items, target);

    res.json({
      ok: true,
      inserted,
      updated,
      skipped,
      totalParsed: items.length,
      category: target,
      durationMs: Date.now() - t0,
      chunked: true
    });
  } catch (e) {
    res.status(500).json({ error: "import failed", details: String(e && e.message ? e.message : e) });
  } finally {
    cleanupDirSafe(dir);
  }
});

router.post("/upload/product-image", requireAdmin, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file too large" });
    }
    if (err) {
      return res.status(400).json({ error: "upload failed", details: String(err.message || err) });
    }
    if (!req.file) return res.status(400).json({ error: "file is required" });

    try {
      const sharp = require("sharp");
      const webpBuf = await sharp(req.file.buffer)
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75, effort: 2 })
        .toBuffer();
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
      fs.mkdirSync(productImagesDir, { recursive: true });
      fs.writeFileSync(path.join(productImagesDir, fileName), webpBuf);
      return res.json({ ok: true, imageUrl: `/uploads/products/${fileName}` });
    } catch (e) {
      const ext = path.extname(String(req.file.originalname || "")).toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
      fs.mkdirSync(productImagesDir, { recursive: true });
      fs.writeFileSync(path.join(productImagesDir, fileName), req.file.buffer);
      return res.json({ ok: true, imageUrl: `/uploads/products/${fileName}` });
    }
  });
});

router.post("/upload/category-video", requireAdmin, (req, res) => {
  videoUpload.single("file")(req, res, (err) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `file too large (max ${videoUploadMaxMb}MB)` });
    }
    if (err) {
      console.error("upload/category-video error:", err);
      return res.status(400).json({ error: "upload failed", details: String(err.message || err) });
    }

    if (!req.file) return res.status(400).json({ error: "file is required" });

    const ext = path.extname(String(req.file.filename || "")).toLowerCase();
    const allowedExt = [".mp4", ".webm", ".ogg"];
    if (!allowedExt.includes(ext)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        // noop
      }
      return res.status(400).json({ error: "unsupported video format (use mp4/webm/ogg)" });
    }

    const videoUrl = `/uploads/category-videos/${req.file.filename}`;
    return res.json({ ok: true, videoUrl });
  });
});

// Товар считается "без фото", когда пусты И одиночное image, И массив images.
// Отсутствующее поле, null и "" трактуются одинаково — импорт из Excel оставляет
// то одно, то другое в зависимости от того, была ли в строке картинка вообще.
const NO_PHOTO_FILTER = {
  $and: [
    { $or: [{ image: { $in: ["", null] } }, { image: { $exists: false } }] },
    { $or: [{ images: { $size: 0 } }, { images: { $exists: false } }] }
  ]
};

// Обе ручки обязаны стоять выше "/products/:id", иначе Express разберёт
// "no-photo" как id товара и вернёт 404/CastError.
router.get("/products/no-photo", requireAdmin, async (req, res) => {
  const count = await Product.countDocuments(NO_PHOTO_FILTER);
  const samples = await Product.find(NO_PHOTO_FILTER, "name brand category_title sku")
    .sort({ category_title: 1, name: 1 })
    .limit(20)
    .lean();

  const byCategoryRows = await Product.aggregate([
    { $match: NO_PHOTO_FILTER },
    { $group: { _id: "$category_title", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  return res.json({
    count,
    samples: samples.map((p) => ({
      id: String(p._id),
      name: p.name,
      brand: p.brand || "",
      category_title: p.category_title || "",
      sku: p.sku || ""
    })),
    byCategory: byCategoryRows.map((r) => ({ category_title: r._id || "", count: r.count }))
  });
});

router.delete("/products/no-photo", requireAdmin, async (req, res) => {
  // Клиент присылает число, которое показал пользователю. Если за время между
  // просмотром и подтверждением импорт добавил/убрал товары, удаление
  // отклоняется — иначе можно молча снести больше, чем было на экране.
  const expected = req.query.expectedCount;
  const count = await Product.countDocuments(NO_PHOTO_FILTER);

  if (expected !== undefined && Number(expected) !== count) {
    return res.status(409).json({
      error: "count changed",
      expectedCount: Number(expected),
      currentCount: count
    });
  }

  const result = await Product.deleteMany(NO_PHOTO_FILTER);
  return res.json({ ok: true, deleted: Number(result?.deletedCount || 0) });
});

router.post("/products", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const category_title = String(body.category_title || "").trim();
  const name = String(body.name || "").trim();

  if (!category_title || !name) return res.status(400).json({ error: "category_title and name are required" });

  const category_id = String(body.category_id || "").trim() || slugify(category_title);
  const sku = String(body.sku || "").trim();
  const key = buildProductKey({
    categoryId: category_id,
    sku,
    brandOrGroup: body.collection || "",
    name,
    size: body.attrs?.size || ""
  });

  const payload = {
    key,
    category_id,
    category_title,
    name,
    brand: String(body.brand || ""),
    collection: String(body.collection || ""),
    subcategory: String(body.subcategory || ""),
    unit: String(body.unit || "шт"),
    sku,
    image: String(body.image || ""),
    images: Array.isArray(body.images) ? body.images.map((x) => String(x || "").trim()).filter(Boolean) : [],
    description: String(body.description || ""),
    stockQty: body.stockQty !== undefined ? Number(body.stockQty) : undefined,
    prices: body.prices || {},
    attrs: body.attrs || {},
    inStock: body.inStock !== undefined ? !!body.inStock : true,
    active: true
  };

  if (sku) {
    const existing = await Product.findOne({ sku, category_id });

    if (existing) {
      existing.key = key;
      existing.category_id = payload.category_id;
      existing.category_title = payload.category_title;
      existing.name = payload.name;
      existing.brand = payload.brand;
      existing.collection = payload.collection;
      existing.subcategory = payload.subcategory;
      existing.unit = payload.unit;
      existing.sku = payload.sku;
      existing.image = payload.image;
      existing.images = payload.images;
      existing.description = payload.description;
      existing.stockQty = payload.stockQty;
      existing.prices = payload.prices;
      existing.attrs = payload.attrs;
      existing.inStock = payload.inStock;
      existing.active = true;

      await existing.save();
      return res.json({ product: existing.toJSON(), updated: true });
    }
  }

  const created = await Product.create(payload);

  res.json({ product: created.toJSON() });
});

router.patch("/products/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const patch = req.body || {};

  const p = await Product.findById(id);
  if (!p) return res.status(404).json({ error: "not found" });

  if (patch.inStock !== undefined) p.inStock = !!patch.inStock;
  if (patch.active !== undefined) p.active = !!patch.active;

  if (patch.name !== undefined) p.name = String(patch.name);
  if (patch.brand !== undefined) p.brand = String(patch.brand);
  if (patch.collection !== undefined) p.collection = String(patch.collection);
  if (patch.subcategory !== undefined) p.subcategory = String(patch.subcategory);
  if (patch.unit !== undefined) p.unit = String(patch.unit);
  if (patch.sku !== undefined) p.sku = String(patch.sku);
  if (patch.image !== undefined) p.image = String(patch.image);
  if (patch.images !== undefined && Array.isArray(patch.images)) p.images = patch.images.map((x) => String(x || "").trim()).filter(Boolean);
  if (patch.description !== undefined) p.description = String(patch.description);
  if (patch.stockQty !== undefined) p.stockQty = Number(patch.stockQty);
  if (patch.category_id !== undefined) p.category_id = String(patch.category_id);
  if (patch.category_title !== undefined) p.category_title = String(patch.category_title);

  if (patch.stockQty !== undefined && patch.inStock === undefined) {
    p.inStock = Number(patch.stockQty) > 0;
  }

  if (patch.prices && typeof patch.prices === "object") {
    p.prices = { ...(p.prices || {}), ...patch.prices };
  }
  if (patch.attrs && typeof patch.attrs === "object") {
    p.attrs = { ...(p.attrs || {}), ...patch.attrs };
  }

  await p.save();
  res.json({ product: p.toJSON() });
});

router.delete("/products/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const p = await Product.findById(id);
  if (!p) return res.status(404).json({ error: "not found" });
  await p.deleteOne();
  res.json({ ok: true });
});

// --------------------
// Orders (Admin)
// --------------------
router.get("/orders", requireAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const skip = (page - 1) * limit;

  const status = String(req.query.status || "").trim();
  const sortBy = String(req.query.sortBy || "date").trim(); // date | status
  const sortDir = String(req.query.sortDir || "desc").trim(); // asc | desc

  const q = {};
  if (status) q.status = status;

  const sort = {};
  if (sortBy === "status") sort.status = sortDir === "asc" ? 1 : -1;
  sort.createdAt = sortDir === "asc" ? 1 : -1;

  const [items, total] = await Promise.all([
    Order.find(q).sort(sort).skip(skip).limit(limit).lean(),
    Order.countDocuments(q)
  ]);

  res.json({
    page,
    limit,
    total,
    items: items.map((o) => ({
      id: String(o._id),
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      customerEmail: o.customerEmail || "",
      address: o.address || "",
      comment: o.comment || "",
      deliveryMethod: o.deliveryMethod || "courier",
      paymentMethod: o.paymentMethod || "kaspi",
      status: o.status,
      total: o.total || 0,
      createdAt: o.createdAt
    }))
  });
});

router.get("/orders/:id", requireAdmin, async (req, res) => {
  const order = await Order.findById(req.params.id).lean();
  if (!order) return res.status(404).json({ error: "order not found" });

  res.json({
    order: {
      id: String(order._id),
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail || "",
      address: order.address || "",
      comment: order.comment || "",
      deliveryMethod: order.deliveryMethod || "courier",
      paymentMethod: order.paymentMethod || "kaspi",
      status: order.status,
      total: order.total || 0,
      items: order.items || [],
      createdAt: order.createdAt
    }
  });
});

router.patch("/orders/:id", requireAdmin, async (req, res) => {
  const status = String(req.body?.status || "").trim();
  if (!["new", "processing", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { $set: { status } },
    { new: true }
  ).lean();

  if (!order) return res.status(404).json({ error: "order not found" });

  res.json({ ok: true, status: order.status });
});

router.delete("/orders/:id", requireAdmin, async (req, res) => {
  const order = await Order.findByIdAndDelete(req.params.id).lean();
  if (!order) return res.status(404).json({ error: "order not found" });
  res.json({ ok: true });
});

router.get("/orders/:id/export", requireAdmin, async (req, res) => {
  const ExcelJS = require("exceljs");
  const order = await Order.findById(req.params.id).lean();
  if (!order) return res.status(404).json({ error: "order not found" });

  const wb = new ExcelJS.Workbook();

  const ws1 = wb.addWorksheet("Order");
  ws1.columns = [
    { header: "Field", key: "field", width: 20 },
    { header: "Value", key: "value", width: 60 },
  ];

  const rows1 = [
    ["Order ID", String(order._id)],
    ["Status", String(order.status || "")],
    ["Created At", order.createdAt ? new Date(order.createdAt).toISOString() : ""],
    ["Customer Name", String(order.customerName || "")],
    ["Customer Phone", String(order.customerPhone || "")],
    ["Customer Email", String(order.customerEmail || "")],
    ["Address", String(order.address || "")],
    ["Comment", String(order.comment || "")],
    ["Delivery Method", String(order.deliveryMethod || "courier")],
    ["Payment Method", String(order.paymentMethod || "kaspi")],
    ["Total", Number(order.total || 0)],
  ].map(([field, value]) => ({ field, value }));

  ws1.addRows(rows1);
  ws1.getRow(1).font = { bold: true };

  const ws2 = wb.addWorksheet("Items");
  ws2.columns = [
    { header: "Name", key: "name", width: 40 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Price", key: "price", width: 12 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Line Total", key: "lineTotal", width: 14 },
    { header: "Image", key: "image", width: 40 },
  ];
  ws2.getRow(1).font = { bold: true };

  const items = Array.isArray(order.items) ? order.items : [];
  ws2.addRows(items.map((it) => ({
    name: String(it.name || ""),
    sku: String(it.sku || ""),
    unit: String(it.unit || ""),
    price: Number(it.price || 0),
    quantity: Number(it.quantity || 0),
    lineTotal: Number(it.lineTotal || 0),
    image: String(it.image || ""),
  })));

  const buf = await wb.xlsx.writeBuffer();

  const fname = `order_${String(order._id)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buf));
});

// --------------------
// Leads (Admin)
// --------------------
router.get("/leads", requireAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const skip = (page - 1) * limit;

  const status = String(req.query.status || "").trim();
  const sortDir = String(req.query.sortDir || "desc").trim(); // asc | desc

  const q = {};
  if (status) q.status = status;

  const sort = { createdAt: sortDir === "asc" ? 1 : -1 };

  const [items, total] = await Promise.all([
    Lead.find(q).sort(sort).skip(skip).limit(limit).lean(),
    Lead.countDocuments(q)
  ]);

  res.json({
    page,
    limit,
    total,
    items: items.map((l) => ({
      id: String(l._id),
      name: l.name,
      phone: l.phone,
      email: l.email || "",
      message: l.message || "",
      status: l.status,
      createdAt: l.createdAt
    }))
  });
});

router.get("/leads/:id", requireAdmin, async (req, res) => {
  const lead = await Lead.findById(req.params.id).lean();
  if (!lead) return res.status(404).json({ error: "lead not found" });
  res.json({
    lead: {
      id: String(lead._id),
      name: lead.name,
      phone: lead.phone,
      email: lead.email || "",
      message: lead.message || "",
      status: lead.status,
      createdAt: lead.createdAt
    }
  });
});

router.patch("/leads/:id", requireAdmin, async (req, res) => {
  const status = String(req.body?.status || "").trim();
  if (!["new", "processing", "done"].includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  const lead = await Lead.findByIdAndUpdate(
    req.params.id,
    { $set: { status } },
    { new: true }
  ).lean();

  if (!lead) return res.status(404).json({ error: "lead not found" });
  res.json({ ok: true, status: lead.status });
});

router.delete("/leads/:id", requireAdmin, async (req, res) => {
  const lead = await Lead.findByIdAndDelete(req.params.id).lean();
  if (!lead) return res.status(404).json({ error: "lead not found" });
  res.json({ ok: true });
});

// ── Site Settings (Homepage Constructor) ──────────────────────────────────
router.get("/site-settings", requireAdmin, async (req, res) => {
  const settings = await SiteSettings.findOne().lean();
  res.json({ ok: true, settings: normalizeSiteSettings(settings || {}) });
});

router.put("/site-settings", requireAdmin, async (req, res) => {
  const patch = req.body || {};
  const allowed = [
    "phone", "email", "address",
    "kaspiEnabled", "kaspiUrl",
    "halykEnabled", "halykUrl",
    "instagramUrl", "facebookUrl",
    "heroSlides", "aboutSlides",
    "homepageImages", "colorSwatches",
  ];
  const update = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }
  const settings = await SiteSettings.findOneAndUpdate(
    {},
    { $set: update },
    { new: true, upsert: true }
  ).lean();
  res.json({ ok: true, settings: normalizeSiteSettings(settings) });
});

// --------------------
// Designers (Admin)
// --------------------
function serializeDesigner(d) {
  return {
    id: String(d._id),
    name: d.name,
    position: d.position || "",
    photo: normalizeImageUrl(d.photo || ""),
    bio: d.bio || "",
    experienceYears: d.experienceYears,
    phone: d.phone || "",
    email: d.email || "",
    instagramUrl: d.instagramUrl || "",
    whatsappUrl: d.whatsappUrl || "",
    portfolio: (Array.isArray(d.portfolio) ? d.portfolio : []).map((x) => normalizeImageUrl(x)).filter(Boolean),
    order: Number(d.order || 0),
    active: d.active !== false
  };
}

router.get("/designers", requireAdmin, async (req, res) => {
  const designers = await Designer.find({}).sort({ order: 1, createdAt: 1 }).lean();
  res.json({ designers: designers.map(serializeDesigner) });
});

router.post("/designers", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });

  const created = await Designer.create({
    name,
    position: String(body.position || "").trim(),
    photo: String(body.photo || "").trim(),
    bio: String(body.bio || "").trim(),
    experienceYears: body.experienceYears !== undefined && body.experienceYears !== "" ? Number(body.experienceYears) : undefined,
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim(),
    instagramUrl: String(body.instagramUrl || "").trim(),
    whatsappUrl: String(body.whatsappUrl || "").trim(),
    portfolio: Array.isArray(body.portfolio) ? body.portfolio.map((x) => String(x || "").trim()).filter(Boolean) : [],
    order: Number(body.order || 0),
    active: body.active !== undefined ? !!body.active : true
  });

  res.json({ designer: serializeDesigner(created) });
});

router.patch("/designers/:id", requireAdmin, async (req, res) => {
  const d = await Designer.findById(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });

  const patch = req.body || {};
  if (patch.name !== undefined) d.name = String(patch.name).trim();
  if (patch.position !== undefined) d.position = String(patch.position).trim();
  if (patch.photo !== undefined) d.photo = String(patch.photo).trim();
  if (patch.bio !== undefined) d.bio = String(patch.bio).trim();
  if (patch.experienceYears !== undefined) {
    d.experienceYears = patch.experienceYears === "" || patch.experienceYears === null ? undefined : Number(patch.experienceYears);
  }
  if (patch.phone !== undefined) d.phone = String(patch.phone).trim();
  if (patch.email !== undefined) d.email = String(patch.email).trim();
  if (patch.instagramUrl !== undefined) d.instagramUrl = String(patch.instagramUrl).trim();
  if (patch.whatsappUrl !== undefined) d.whatsappUrl = String(patch.whatsappUrl).trim();
  if (patch.portfolio !== undefined && Array.isArray(patch.portfolio)) {
    d.portfolio = patch.portfolio.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (patch.order !== undefined) d.order = Number(patch.order || 0);
  if (patch.active !== undefined) d.active = !!patch.active;

  if (!String(d.name || "").trim()) return res.status(400).json({ error: "name is required" });

  await d.save();
  res.json({ designer: serializeDesigner(d) });
});

router.delete("/designers/:id", requireAdmin, async (req, res) => {
  const d = await Designer.findByIdAndDelete(req.params.id).lean();
  if (!d) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

module.exports = router;
