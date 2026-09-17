const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Gemini's structured-output schema is a restricted subset of OpenAPI (no
// nullable enum members, and enum values can't be empty strings), so "not in
// the list" is represented with a "none" sentinel and normalized to null
// afterwards.
const NO_CATEGORY = "none";

// The category enum has to be built per-request from the live catalog
// (passed in as `categories`), not hardcoded: it used to be a fixed list of
// 6 categories with old ids ("smesiteli-dlya-rakoviny", "aksessuary", ...)
// that no longer match any product in the DB after the catalog was
// restructured to today's 10 categories with different (Cyrillic-slug) ids -
// every match then filtered on a category_id that existed nowhere, silently
// returning zero results for every photo.
function buildComponentSchema(categories) {
  return {
    type: "OBJECT",
    properties: {
      components: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", description: "Короткое название компонента по-русски, напр. 'смеситель для раковины'" },
            category_id: {
              type: "STRING",
              enum: [...categories.map((c) => c.id), NO_CATEGORY],
              description: `id категории из списка, либо "${NO_CATEGORY}" если не подходит ни одна`
            },
            description: { type: "STRING", description: "Краткое описание внешнего вида: форма, цвет/покрытие, стиль" },
            keywords: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "3-8 ключевых слов на русском для поиска (цвет, форма, тип монтажа и т.д.)"
            }
          },
          required: ["type", "category_id", "description", "keywords"]
        }
      }
    },
    required: ["components"]
  };
}

// Photos come straight from a phone camera or a screenshot (often several MB,
// far larger than Gemini needs to identify a fixture) — the upload and the
// model's own image-processing time both scale with payload size. Shrinking
// to a still-plenty-detailed 1280px/JPEG before sending noticeably cuts
// response time without hurting recognition quality. Falls back to the
// original bytes if sharp can't decode the input for any reason.
async function prepareImageForGemini(buffer, mediaType) {
  try {
    const sharp = require("sharp");
    const resized = await sharp(buffer)
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buffer: resized, mediaType: "image/jpeg" };
  } catch (e) {
    return { buffer, mediaType };
  }
}

async function analyzeImage({ buffer, mediaType, categories }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("No catalog categories available for visual search");
  }

  const categoryList = categories.map((c) => `- ${c.id}: ${c.title}`).join("\n");
  const prepared = await prepareImageForGemini(buffer, mediaType);

  const requestBody = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: prepared.mediaType, data: prepared.buffer.toString("base64") } },
          {
            text:
              "На фото — интерьер или элементы ванной комнаты. Определи каждый видимый сантехнический компонент " +
              "(смесители, душевые системы, полотенцесушители, унитазы, инсталляции, аксессуары и т.д.).\n\n" +
              "Для каждого компонента укажи наиболее подходящую категорию из списка:\n" +
              categoryList +
              `\n\nЕсли компонент не относится ни к одной категории, укажи category_id: "${NO_CATEGORY}". ` +
              "Не включай элементы, не относящиеся к сантехнике (плитка, мебель, зеркала и т.п.), если они явно не являются частью выбранных категорий."
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: buildComponentSchema(categories)
    }
  };

  // Gemini's free tier returns 503 ("high demand") / 429 fairly often; a couple
  // of quick retries turn what the user would see as "сайт не работает" into a
  // slightly slower but successful request.
  let res;
  let lastErrText = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );

    if (res.ok) break;

    lastErrText = await res.text().catch(() => "");
    const retryable = res.status === 503 || res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) {
      throw new Error(`Gemini API error ${res.status}: ${lastErrText.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  if (!text) return { components: [] };

  try {
    const parsed = JSON.parse(text);
    const components = Array.isArray(parsed.components) ? parsed.components : [];
    return {
      components: components.map((c) => ({
        ...c,
        category_id: c.category_id && c.category_id !== NO_CATEGORY ? c.category_id : null
      }))
    };
  } catch (e) {
    return { components: [] };
  }
}

// The catalog spells colours without ё ("Черный матовый"), while the model
// naturally returns correctly-spelled Russian ("чёрный") — without folding
// ё→е a black/чёрный fixture matches nothing at all.
function normalizeForMatch(value) {
  return String(value || "").toLowerCase().replace(/ё/g, "е").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Fields carry different signal strength for "is this the product in the
// photo": the product name is the strongest signal, attrs (material, shape,
// mount type...) are specific and reliable, brand/collection are weak on
// their own (a keyword like "хром" matching the brand name would be a
// coincidence, not a real signal).
const FIELD_WEIGHTS = { name: 3, attr: 2, collection: 1, brand: 1 };

// Previously this scored a keyword as a hit whenever it was a raw substring
// of the concatenated name+brand+collection+attrs text (e.g. the keyword
// "душ" would "match" a product whose name merely contains "душевой" as part
// of an unrelated word), with every match worth the same regardless of which
// field it came from — a shower head and a random accessory that both
// mentioned "хром" once scored identically. Matching whole words, weighting
// by field, and rewarding an exact field match make the top results
// noticeably more often the right ones.
function scoreProduct(product, keywords) {
  const fields = [
    { text: product.name, weight: FIELD_WEIGHTS.name },
    { text: product.collection, weight: FIELD_WEIGHTS.collection },
    { text: product.brand, weight: FIELD_WEIGHTS.brand },
    ...Object.values(product.attrs || {}).map((v) => ({ text: v, weight: FIELD_WEIGHTS.attr }))
  ]
    .map(({ text, weight }) => ({ text: normalizeForMatch(text), weight }))
    .filter(({ text }) => text);

  let score = 0;
  for (const kw of keywords) {
    const k = normalizeForMatch(kw);
    if (!k) continue;
    const wordBoundary = new RegExp(`(^|\\W)${escapeRegExp(k)}($|\\W)`);
    for (const { text, weight } of fields) {
      if (text === k) score += weight * 2;
      else if (wordBoundary.test(text)) score += weight;
      else if (text.includes(k)) score += weight * 0.3;
    }
  }
  return score;
}

async function findMatches({ Product, component, limit = 6 }) {
  const filter = { active: true, inStock: true };
  if (component.category_id) filter.category_id = component.category_id;

  const candidates = await Product.find(filter).limit(500).lean();
  const keywords = [...(component.keywords || []), component.type].filter(Boolean);

  const scored = candidates
    .map((p) => ({ product: p, score: scoreProduct(p, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Fallback: if nothing scored, still show a few products from the matched category
  if (scored.length === 0 && component.category_id) {
    return candidates.slice(0, limit).map((p) => ({ product: p, score: 0 }));
  }

  return scored;
}

module.exports = { analyzeImage, findMatches };
