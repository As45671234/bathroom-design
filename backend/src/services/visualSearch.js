const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

// Google refuses the request outright when it comes from the production host's
// ASN (see resolveProvider below), so prod points this at a thin pass-through
// proxy that forwards to Google from an unblocked network. The proxy must keep
// the path and query intact - only the origin is swapped.
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com")
  .replace(/\/+$/, "");

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
// Gemini is the preferred provider: side-by-side on the same bathroom photo it
// identified 7 fixtures where Groq's qwen found 1, and it read the basin mixer
// as "золотой, на раковину" where Groq called the same tap "настенный, хром" -
// wrong colour and wrong mount, which then steered the whole match downstream.
function hasKey(provider) {
  return provider === "groq" ? Boolean(process.env.GROQ_API_KEY) : Boolean(process.env.GEMINI_API_KEY);
}

function resolveProvider() {
  const explicit = String(process.env.VISUAL_SEARCH_PROVIDER || "").trim().toLowerCase();
  if (explicit === "groq" || explicit === "gemini") return explicit;
  return hasKey("gemini") ? "gemini" : "groq";
}

function isConfigured() {
  return hasKey("gemini") || hasKey("groq");
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
    "Не включай элементы, не относящиеся к сантехнике (плитка, мебель, зеркала и т.п.), если они явно не являются частью выбранных категорий.\n\n" +
    // Mount type is what a person actually points at in a photo and it is a
    // filterable attribute on almost every product, but the model only
    // volunteered it sometimes - so a deck-mounted gold tap kept matching
    // concealed and wall-mounted ones that were gold too. Asking for the term
    // verbatim gives the scorer something decisive to match on.
    "В keywords обязательно включи тип установки, если он виден на фото, используя точную формулировку: " +
    "«на раковину», «настенный», «встраиваемый», «напольный», «подвесной», «накладная», «врезная». " +
    "Для смесителя всегда указывай, стоит он на раковине, на стене или встроен в стену."
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
    `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Keeps the proxy from being usable as an open Gemini relay by anyone
        // who guesses its address. Ignored when talking to Google directly.
        ...(process.env.GEMINI_PROXY_SECRET ? { "x-proxy-secret": process.env.GEMINI_PROXY_SECRET } : {})
      },
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

  const run = { gemini: analyzeWithGemini, groq: analyzeWithGroq };
  const primary = resolveProvider();
  const secondary = primary === "gemini" ? "groq" : "gemini";

  try {
    return await run[primary]({ buffer, mediaType, categories });
  } catch (err) {
    // Gemini reaches Google through a proxy we don't control; if that hop dies
    // the feature should degrade to the weaker model rather than 503 the user.
    if (!hasKey(secondary)) throw err;
    console.error(`[visual-search] ${primary} failed, falling back to ${secondary}:`, err.message);
    return run[secondary]({ buffer, mediaType, categories });
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

// The model writes ordinary inflected Russian while the catalog stores its own
// grammatical forms, so the two never line up literally: "подвесной унитаз" vs
// attr "Установка: Подвесная", "золотой" vs "Цвет: Золото". Neither whole-word
// nor substring matching catches those pairs, which is why a wall-hung toilet
// scored below a floor-standing one. Cutting the inflectional ending (longest
// first, never below 3 chars so "душ" can't collapse into "душевой") makes the
// forms comparable without pulling in a real stemmer.
const RU_ENDINGS = [
  "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими",
  "ая", "яя", "ое", "ее", "ые", "ие", "ый", "ий", "ой", "ым", "им",
  "ом", "ем", "ую", "юю", "ых", "их", "ов", "ев", "ей",
  "а", "я", "ы", "и", "у", "ю", "е", "о", "ь", "й"
];

function stemRu(word) {
  for (const ending of RU_ENDINGS) {
    if (word.length - ending.length >= 3 && word.endsWith(ending)) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

function stemsOf(text) {
  return new Set((text.match(/[a-zа-я0-9]+/g) || []).map(stemRu));
}

// Fields carry different signal strength for "is this the product in the
// photo": the product name is the strongest signal, attrs (material, shape,
// mount type...) are specific and reliable, brand/collection are weak on
// their own (a keyword like "хром" matching the brand name would be a
// coincidence, not a real signal).
const FIELD_WEIGHTS = { name: 3, attr: 2, keyAttr: 4, collection: 1, brand: 1 };

// Not all attrs are equally decisive. Whether a mixer is wall-mounted or sits
// on the basin, and what colour it is, are the things a person actually points
// at in a photo; "Материал: Латунь" is true of almost the whole catalogue. With
// every attr weighted the same, those tie-breakers drowned in noise.
const KEY_ATTRS = new Set([
  "установка", "назначение", "цвет", "название цвета", "color", "тип излива", "форма излива"
]);

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
    ...Object.entries(product.attrs || {}).map(([key, v]) => ({
      text: v,
      weight: KEY_ATTRS.has(normalizeForMatch(key)) ? FIELD_WEIGHTS.keyAttr : FIELD_WEIGHTS.attr
    }))
  ]
    .map(({ text, weight }) => ({ text: normalizeForMatch(text), weight }))
    .filter(({ text }) => text)
    .map((field) => ({ ...field, stems: stemsOf(field.text) }));

  let score = 0;
  for (const kw of keywords) {
    const k = normalizeForMatch(kw);
    if (!k) continue;
    const wordBoundary = new RegExp(`(^|\\W)${escapeRegExp(k)}($|\\W)`);
    // A multi-word keyword ("для раковины") only counts as a stem hit when all
    // of its words are present, otherwise "для" alone would match everything.
    const kwStems = [...stemsOf(k)];

    for (const { text, weight, stems } of fields) {
      if (text === k) score += weight * 2;
      else if (wordBoundary.test(text)) score += weight;
      else if (kwStems.length && kwStems.every((s) => stems.has(s))) score += weight;
      else if (text.includes(k)) score += weight * 0.3;
    }
  }
  return score;
}

async function findMatches({ Product, component, limit = 6 }) {
  const filter = { active: true, inStock: true };
  if (component.category_id) filter.category_id = component.category_id;

  // The cap used to be 500 while "Смесители" alone holds 1211 products, so 59%
  // of that category was never even scored - the right item could not win
  // because it was never a candidate. The bound stays only as a guard against a
  // future catalogue that outgrows memory; today it admits every category.
  const candidates = await Product.find(filter).limit(5000).lean();
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
