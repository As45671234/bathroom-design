const express = require("express");
const multer = require("multer");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Lead = require("../models/Lead");
const CategoryMeta = require("../models/CategoryMeta");
const SiteSettings = require("../models/SiteSettings");
const Designer = require("../models/Designer");
const { normalizeImageUrl, normalizeSiteSettings } = require("../utils");
const { analyzeImage, findMatches, isConfigured } = require("../services/visualSearch");

const visualSearchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Unsupported image type"), ok);
  }
});

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((it) => {
      const quantity = Number(it.quantity || 0);
      const price = Number(it.prices?.retail ?? it.price);
      const lineTotal = (Number.isFinite(price) ? price : 0) * (Number.isFinite(quantity) ? quantity : 0);

      return {
        productId: it.id ? String(it.id) : (it.productId ? String(it.productId) : ""),
        name: String(it.name || "").trim(),
        sku: String(it.sku || "").trim(),
        unit: String(it.unit || "шт"),
        image: String(it.image || ""),
        price: Number.isFinite(price) ? price : undefined,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        lineTotal: Number.isFinite(lineTotal) ? lineTotal : 0
      };
    })
    .filter((x) => x.name && x.quantity > 0);
}

async function createOrderFromPayload(payload) {
  const { customerName, customerPhone, customerEmail, address, comment, deliveryMethod, paymentMethod, items, total } = payload || {};
  if (!customerPhone || !Array.isArray(items) || items.length === 0) return null;

  const cleanItems = normalizeOrderItems(items);
  if (cleanItems.length === 0) return null;

  const computedTotal = cleanItems.reduce((s, x) => s + Number(x.lineTotal || 0), 0);
  const finalTotal = Number.isFinite(Number(total)) ? Number(total) : computedTotal;

  const normalizedDeliveryMethod = ["courier", "pickup", "transport_company"].includes(String(deliveryMethod || "").trim())
    ? String(deliveryMethod).trim()
    : "courier";

  const normalizedPaymentMethod = ["kaspi", "halyk", "cash"].includes(String(paymentMethod || "").trim())
    ? String(paymentMethod).trim()
    : "kaspi";

  return Order.create({
    customerName: String(customerName || "").trim(),
    customerPhone: String(customerPhone).trim(),
    customerEmail: String(customerEmail || "").trim(),
    address: String(address || "").trim(),
    comment: String(comment || "").trim(),
    deliveryMethod: normalizedDeliveryMethod,
    paymentMethod: normalizedPaymentMethod,
    items: cleanItems,
    total: finalTotal
  });
}

function publicRoutes(emailLimiter) {
  const router = express.Router();

  // Catalog for website (only active + inStock)
  router.get("/catalog", async (req, res) => {
    const products = await Product.find({ active: true, inStock: true }).sort({ category_title: 1, name: 1 }).lean();
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
      const cat = categoriesMap.get(catId);
      cat.items.push({
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

    const catIds = Array.from(categoriesMap.keys());
    if (catIds.length > 0) {
      const metas = await CategoryMeta.find({ category_id: { $in: catIds } }).lean();
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
    }

    res.json({ categories: Array.from(categoriesMap.values()) });
  });

  // Visual search: upload a photo, AI detects bathroom components, we find matching catalog products
  router.post("/visual-search", visualSearchUpload.single("image"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл изображения обязателен" });

    if (!isConfigured()) {
      return res.status(503).json({ error: "Функция распознавания фото временно недоступна" });
    }

    try {
      // Category list for the AI prompt/schema has to reflect the live
      // catalog (see visualSearch.js) — it changes whenever the owner
      // restructures categories, most recently 6 Latin-slug categories -> 10
      // Cyrillic-slug ones.
      const categoryRows = await Product.aggregate([
        { $match: { active: true, inStock: true } },
        { $group: { _id: "$category_id", title: { $first: "$category_title" } } }
      ]);
      const categories = categoryRows
        .filter((c) => c._id)
        .map((c) => ({ id: c._id, title: c.title }));

      // Same fix as categories above, applied to the shape/style vocabulary the
      // prompt asks the model to use: a fixed word list drifts from whatever the
      // supplier data actually contains (an audit found "угловатая"/"плоская"
      // appear ~0-1 times catalog-wide, while real values like "полукруглая"/
      // "овальная" were missing from the prompt entirely), so it's built from
      // the live "Форма"/"Линии форм"/"Дизайн" attr values instead.
      const SHAPE_ATTR_KEYS = ["Форма", "Линии форм", "Дизайн"];
      const shapeRows = await Product.aggregate([
        { $match: { active: true, inStock: true } },
        { $project: { attrs: { $objectToArray: "$attrs" } } },
        { $unwind: "$attrs" },
        { $match: { "attrs.k": { $in: SHAPE_ATTR_KEYS } } },
        { $group: { _id: "$attrs.v", count: { $sum: 1 } } }
      ]);
      // Mongo's $toLower only affects ASCII, so Cyrillic case-folding (and the
      // dedup it enables, e.g. "Модерн"/"модерн" as separate raw values) has to
      // happen in JS instead.
      const shapeCounts = new Map();
      for (const row of shapeRows) {
        const value = String(row._id || "").toLowerCase().trim();
        if (!value) continue;
        shapeCounts.set(value, (shapeCounts.get(value) || 0) + row.count);
      }
      const shapeVocabulary = [...shapeCounts.entries()]
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([value]) => value);

      const { components } = await analyzeImage({
        buffer: req.file.buffer,
        mediaType: req.file.mimetype,
        categories,
        shapeVocabulary
      });

      const results = [];
      for (const component of components) {
        const matches = await findMatches({ Product, component, limit: 3 });
        if (matches.length === 0) {
          // No dashboard for this yet, but pm2 keeps stdout - grepping these
          // lines is the cheapest way to spot systematic blind spots (e.g. a
          // component type this catalog never carries, or a category the
          // model keeps misreading) without building analytics infra first.
          console.log(
            `[visual-search] no matches: type="${component.type}" category=${component.category_id} ` +
            `mount=${component.mount_type} keywords=${(component.keywords || []).join(", ")}`
          );
        }
        results.push({
          type: component.type,
          description: component.description,
          category_id: component.category_id,
          matches: matches.map(({ product, score }) => ({
            id: String(product._id),
            name: product.name,
            brand: product.brand || "",
            collection: product.collection || "",
            sku: product.sku || "",
            image: normalizeImageUrl(product.image),
            images: (Array.isArray(product.images) ? product.images : []).map((x) => normalizeImageUrl(x)).filter(Boolean),
            category_id: product.category_id,
            category_title: product.category_title,
            attrs: product.attrs || {},
            prices: product.prices || {},
            score
          }))
        });
      }

      res.json({ components: results });
    } catch (e) {
      console.error("visual-search error:", e.message);
      res.status(500).json({ error: "Не удалось обработать изображение" });
    }
  });

  // Lead form: save to DB only
  router.post("/leads", emailLimiter, async (req, res) => {
    const { name, phone, email, message } = req.body || {};
    if (!phone) return res.status(400).json({ error: "phone is required" });

    const lead = await Lead.create({
      name: String(name || "").trim(),
      phone: String(phone).trim(),
      email: String(email || "").trim(),
      message: String(message || "").trim()
    });

    res.json({ ok: true, id: String(lead._id) });
  });

  // Order endpoint: save to DB only
  router.post("/orders", emailLimiter, async (req, res) => {
    const order = await createOrderFromPayload(req.body || {});
    if (!order) return res.status(400).json({ error: "invalid order" });
    res.json({ ok: true, id: String(order._id) });
  });

  // Public site settings (phone, email, address, payment links, hero/about slides)
  router.get("/site-settings", async (req, res) => {
    const settings = await SiteSettings.findOne().lean();
    res.json({ ok: true, settings: normalizeSiteSettings(settings || {}) });
  });

  // Designers (public profiles: photo, position, bio, contacts, portfolio)
  router.get("/designers", async (req, res) => {
    const designers = await Designer.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({
      designers: designers.map((d) => ({
        id: String(d._id),
        name: d.name,
        position: d.position || "",
        photo: normalizeImageUrl(d.photo),
        bio: d.bio || "",
        experienceYears: d.experienceYears,
        phone: d.phone || "",
        email: d.email || "",
        instagramUrl: d.instagramUrl || "",
        whatsappUrl: d.whatsappUrl || "",
        portfolio: (Array.isArray(d.portfolio) ? d.portfolio : []).map((x) => normalizeImageUrl(x)).filter(Boolean)
      }))
    });
  });

  return router;
}

module.exports = publicRoutes;
