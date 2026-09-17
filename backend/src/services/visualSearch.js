const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

// Gemini's structured-output schema is a restricted subset of OpenAPI (no
// nullable enum members, and enum values can't be empty strings), so "not in
// the list" is represented with a "none" sentinel and normalized to null
// afterwards.
const NO_CATEGORY = "none";

// Google geo-blocks the Gemini API for whole countries: from the production
// server (a KZ datacenter) every call fails with 400 FAILED_PRECONDITION
// "User location is not supported for the API use.", while the same key works
// from a local machine on a consumer ISP. Groq is reachable from there, so the
// provider is selectable: prod sets GROQ_API_KEY, local dev can keep using
// Gemini. Explicit VISUAL_SEARCH_PROVIDER wins; otherwise whichever key exists.
function resolveProvider() {
  const explicit = String(process.env.VISUAL_SEARCH_PROVIDER || "").trim().toLowerCase();
  if (explicit === "groq" || explicit === "gemini") return explicit;
  return process.env.GROQ_API_KEY ? "groq" : "gemini";
}

function isConfigured() {
  return resolveProvider() === "groq"
    ? Boolean(process.env.GROQ_API_KEY)
    : Boolean(process.env.GEMINI_API_KEY);
}

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

// Groq speaks OpenAI's `json_schema` response format, which is plain JSON
// Schema rather than Gemini's OpenAPI dialect, and strict mode additionally
// requires `additionalProperties: false` on every object.
function buildGroqSchema(categories) {
  return {
    type: "object",
    properties: {
      components: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            category_id: { type: "string", enum: [...categories.map((c) => c.id), NO_CATEGORY] },
            description: { type: "string" },
            keywords: { type: "array", items: { type: "string" } }
          },
          required: ["type", "category_id", "description", "keywords"],
          additionalProperties: false
        }
      }
    },
    required: ["components"],
    additionalProperties: false
  };
}

function buildPrompt(categories) {
  const categoryList = categories.map((c) => `- ${c.id}: ${c.title}`).join("\n");
  return (
    "На фото — интерьер или элементы ванной комнаты. Определи каждый видимый сантехнический компонент " +
    "(смесители, душевые системы, полотенцесушители, унитазы, инсталляции, аксессуары и т.д.).\n\n" +
    "Для каждого компонента укажи наиболее подходящую категорию из списка:\n" +
    categoryList +
    `\n\nЕсли компонент не относится ни к одной категории, укажи category_id: "${NO_CATEGORY}". ` +
    "Не включай элементы, не относящиеся к сантехнике (плитка, мебель, зеркала и т.п.), если они явно не являются частью выбранных категорий."
  );
}

// Photos come straight from a phone camera or a screenshot (often several MB,
// far larger than the model needs to identify a fixture) — the upload and the
// model's own image-processing time both scale with payload size. Shrinking
// to a still-plenty-detailed 1280px/JPEG before sending noticeably cuts
// response time without hurting recognition quality. Falls back to the
// original bytes if sharp can't decode the input for any reason.
async function prepareImage(buffer, mediaType) {
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

// Both providers' free tiers return 503 ("high demand") / 429 fairly often; a
// couple of quick retries turn what the user would see as "сайт не работает"
// into a slightly slower but successful request.
async function postWithRetry(label, url, options) {
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, options);
    if (res.ok) return res;

    const errText = await res.text().catch(() => "");
    const retryable = res.status === 503 || res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) {
      throw new Error(`${label} API error ${res.status}: ${errText.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  return res;
}

function parseComponents(text) {
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

async function analyzeWithGemini({ buffer, mediaType, categories }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const prepared = await prepareImage(buffer, mediaType);
  const requestBody = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: prepared.mediaType, data: prepared.buffer.toString("base64") } },
          { text: buildPrompt(categories) }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: buildComponentSchema(categories)
    }
  };

  const res = await postWithRetry(
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    }
  );

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  return parseComponents(text);
}

async function analyzeWithGroq({ buffer, mediaType, categories }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const prepared = await prepareImage(buffer, mediaType);
  const dataUrl = `data:${prepared.mediaType};base64,${prepared.buffer.toString("base64")}`;

  // The model answers in English by default even when the prompt is Russian,
  // and English keywords match nothing in a Russian catalog — hence the
  // explicit language instruction on top of the shared prompt.
  const requestBody = {
    model: GROQ_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              buildPrompt(categories) +
              "\n\nВсе значения полей type, description и keywords пиши ТОЛЬКО на русском языке."
          },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "components", strict: true, schema: buildGroqSchema(categories) }
    },
    temperature: 0,
    max_tokens: 2000
  };

  const res = await postWithRetry("Groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody)
  });

  const data = await res.json();
  return parseComponents(data?.choices?.[0]?.message?.content);
}

async function analyzeImage({ buffer, mediaType, categories }) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("No catalog categories available for visual search");
  }

  return resolveProvider() === "groq"
    ? analyzeWithGroq({ buffer, mediaType, categories })
    : analyzeWithGemini({ buffer, mediaType, categories });
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

module.exports = { analyzeImage, findMatches, isConfigured };
