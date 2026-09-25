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

// Mount type used to be just one of several free-text `keywords` the model
// was asked to "remember to include" - it demonstrably skipped it on some
// photos (a plain counter-standing mixer came back with zero mount keyword,
// and without one, concealed/wall-mount products tied for the top score with
// the correct on-counter ones). Making it its own required enum field, same
// trick as category_id below, means the model has to commit to an answer
// every time instead of it being an easily-dropped afterthought.
const MOUNT_TYPES = ["на раковину", "настенный", "встраиваемый", "напольный", "подвесной", "накладная", "врезная"];
const NO_MOUNT = "none";

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
            mount_type: {
              type: "STRING",
              enum: [...MOUNT_TYPES, NO_MOUNT],
              description: `Как установлен компонент, либо "${NO_MOUNT}" если не применимо/не видно`
            },
            description: { type: "STRING", description: "Краткое описание внешнего вида: форма, цвет/покрытие, стиль" },
            keywords: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "3-8 ключевых слов на русском для поиска (цвет, форма и т.д.)"
            }
          },
          required: ["type", "category_id", "mount_type", "description", "keywords"]
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
            mount_type: { type: "string", enum: [...MOUNT_TYPES, NO_MOUNT] },
            description: { type: "string" },
            keywords: { type: "array", items: { type: "string" } }
          },
          required: ["type", "category_id", "mount_type", "description", "keywords"],
          additionalProperties: false
        }
      }
    },
    required: ["components"],
    additionalProperties: false
  };
}

// Fallback used only if the live-catalog aggregation (see public.js) finds
// fewer than a handful of distinct values - e.g. an empty/near-empty catalog
// in local dev. On real data the caller-supplied list wins.
const DEFAULT_SHAPE_VOCABULARY = [
  "округлая", "круглая", "квадратная", "прямоугольная", "угловатая", "плоская",
  "модерн", "лофт", "классика", "минимализм"
];

function buildPrompt(categories, shapeVocabulary) {
  const categoryList = categories.map((c) => `- ${c.id}: ${c.title}`).join("\n");
  const shapeWords = Array.isArray(shapeVocabulary) && shapeVocabulary.length >= 4
    ? shapeVocabulary
    : DEFAULT_SHAPE_VOCABULARY;
  const shapeWordList = shapeWords.map((w) => `«${w}»`).join(", ");
  return (
    "На фото — интерьер или элементы ванной комнаты. Определи каждый видимый сантехнический компонент " +
    "(смесители, душевые системы, полотенцесушители, унитазы, инсталляции, аксессуары и т.д.).\n\n" +
    "Для каждого компонента укажи наиболее подходящую категорию из списка:\n" +
    categoryList +
    `\n\nЕсли компонент не относится ни к одной категории, укажи category_id: "${NO_CATEGORY}". ` +
    "Не включай элементы, не относящиеся к сантехнике (плитка, мебель, зеркала и т.п.), если они явно не являются частью выбранных категорий.\n\n" +
    "Не выделяй вешалки и держатели полотенец — их подбирать не нужно, даже если они хорошо видны.\n\n" +
    // mount_type is now its own required schema field (see buildComponentSchema)
    // rather than "please remember to add this to keywords too" - it was
    // getting dropped on some photos, and a mixer with no mount keyword tied
    // concealed/wall-mount products with correct on-counter ones for the top
    // score. Для смесителя это почти всегда легко определяется по фото:
    // стоит ли корпус на раковине/столешнице, или на фото виден только рычаг
    // и излив на стене/в стене.
    "Поле mount_type заполняй всегда, когда тип установки виден на фото - особенно для смесителей: " +
    "стоит ли корпус на раковине/столешнице, торчит из стены, стоит на полу и т.д.\n\n" +
    // Мало толку от точного цвета и монтажа, если форма/силуэт смесителя
    // выбран неверно - это то, что человек различает на фото первым делом.
    // Каталог хранит эти признаки в атрибутах "Форма", "Линии форм" и
    // "Дизайн" с ограниченным набором значений, поэтому просим модель
    // использовать те же слова, а не описывать форму своими словами в
    // description (description не участвует в подборе товаров).
    "Для смесителей, раковин, душевых систем и другой сантехники с выраженной формой " +
    "обязательно включи в keywords форму/силуэт, используя точную формулировку из этого списка " +
    `(выбери максимально подходящее, можно несколько): ${shapeWordList}. ` +
    "Не заменяй эти слова описанием формы в свободной форме - именно эти формулировки ищутся в каталоге."
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

// Asked for by the owner: hangers and towel holders should never come back from
// a photo. Both models keep volunteering them anyway, and the matches were junk
// (a towel rail pulled in a hook, a toilet-paper holder, a cup and a brush), so
// the prompt instruction is backed up by dropping them here. Deliberately does
// not catch "полотенцесушитель" - heated towel rails are a real product line.
const EXCLUDED_COMPONENT = /вешалк|полотенцедержат|держател\S*\s+(?:для\s+)?полотен/i;

// A photo shows the whole fixture, but the catalog also lists its individual
// spare parts/accessories as separate products (toilet seat, tank, mounting
// kit) under the same category - e.g. "Крышка-сиденье для унитаза" and
// "Крепежный комплект для подвесного унитаза" both live in "керамика"
// alongside the actual "Чаша подвесного унитаза". These often score just as
// high or higher than the real fixture (a lid's whole name is basically the
// keyword "унитаз" + "крышка"), so a photo of a toilet returned a mounting
// bracket ahead of any toilet. Filtered out before scoring rather than
// down-weighted, since no photo-driven search should ever surface a spare
// part as "the product in this photo".
const SPARE_PART_PRODUCT = /^(крышка-сиденье|сиденье для|бачок для|сливной бачок|крепежный комплект|монтажный комплект|ремкомплект|комплект (для|крепления))/i;

function parseComponents(text) {
  if (!text) return { components: [] };
  try {
    const parsed = JSON.parse(text);
    const components = Array.isArray(parsed.components) ? parsed.components : [];
    return {
      components: components
        .filter((c) => !EXCLUDED_COMPONENT.test(`${c.type || ""} ${c.description || ""}`))
        .map((c) => ({
          ...c,
          category_id: c.category_id && c.category_id !== NO_CATEGORY ? c.category_id : null,
          mount_type: c.mount_type && c.mount_type !== NO_MOUNT ? c.mount_type : null
        }))
    };
  } catch (e) {
    return { components: [] };
  }
}

async function analyzeWithGemini({ buffer, mediaType, categories, shapeVocabulary }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const prepared = await prepareImage(buffer, mediaType);
  const requestBody = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: prepared.mediaType, data: prepared.buffer.toString("base64") } },
          { text: buildPrompt(categories, shapeVocabulary) }
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

async function analyzeWithGroq({ buffer, mediaType, categories, shapeVocabulary }) {
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
              buildPrompt(categories, shapeVocabulary) +
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

async function analyzeImage({ buffer, mediaType, categories, shapeVocabulary }) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("No catalog categories available for visual search");
  }

  const run = { gemini: analyzeWithGemini, groq: analyzeWithGroq };
  const primary = resolveProvider();
  const secondary = primary === "gemini" ? "groq" : "gemini";

  try {
    return await run[primary]({ buffer, mediaType, categories, shapeVocabulary });
  } catch (err) {
    // Gemini reaches Google through a proxy we don't control; if that hop dies
    // the feature should degrade to the weaker model rather than 503 the user.
    if (!hasKey(secondary)) throw err;
    console.error(`[visual-search] ${primary} failed, falling back to ${secondary}:`, err.message);
    return run[secondary]({ buffer, mediaType, categories, shapeVocabulary });
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
// A production audit (2026-09-25, ~1900 active products) found the supplier
// data spreads mount info across four differently-named attrs - "Установка"
// (759 uses catalog-wide, the dominant one), "Тип монтажа" (99), "Вид монтажа"
// (101, comparable to "Тип монтажа" but previously not boosted or vetoed on at
// all) and "Монтаж" (48, mostly on ванны). "форма"/"линии форм"/"дизайн" are
// where the catalog actually stores silhouette/style (округлая, угловатая,
// модерн, лофт...) - without these, a correctly-detected mixer with the right
// color and mount still ranked shape-mismatched products just as high.
const KEY_ATTRS = new Set([
  "установка", "тип монтажа", "вид монтажа", "монтаж", "назначение", "цвет", "название цвета", "color",
  "тип излива", "форма излива", "форма", "линии форм", "дизайн"
]);

// Mount type is the one attribute where "no bonus for matching" isn't a
// strong enough signal - a concealed mixer is not a substitute photo match
// for a counter-standing one, ever, regardless of how well color/shape/brand
// line up. These groups classify both the model's mount_type answer and the
// catalog's free-text "Установка"/"Тип монтажа" values into the same small
// set of mutually exclusive buckets so a genuine conflict between them can be
// detected and vetoed outright, not just left unrewarded.
const MOUNT_GROUPS = [
  { group: "на раковину", re: /раковин|столешниц|мойк/i },
  { group: "настенный", re: /(?:^|[^а-я])стен/i },
  { group: "встраиваемый", re: /скрыт|встрое|встраива/i },
  { group: "напольный", re: /напольн/i },
  { group: "подвесной", re: /подвесн/i },
  { group: "накладная", re: /накладн/i },
  { group: "врезная", re: /врезн/i }
];

function mountGroupsOf(text) {
  const t = String(text || "").toLowerCase();
  return MOUNT_GROUPS.filter(({ re }) => re.test(t)).map(({ group }) => group);
}

// Previously this scored a keyword as a hit whenever it was a raw substring
// of the concatenated name+brand+collection+attrs text (e.g. the keyword
// "душ" would "match" a product whose name merely contains "душевой" as part
// of an unrelated word), with every match worth the same regardless of which
// field it came from — a shower head and a random accessory that both
// mentioned "хром" once scored identically. Matching whole words, weighting
// by field, and rewarding an exact field match make the top results
// noticeably more often the right ones.
function scoreProduct(product, keywords, typeKeyword, mountType) {
  const rawFields = [
    { text: product.name, weight: FIELD_WEIGHTS.name },
    { text: product.collection, weight: FIELD_WEIGHTS.collection },
    { text: product.brand, weight: FIELD_WEIGHTS.brand },
    ...Object.entries(product.attrs || {}).map(([key, v]) => ({
      text: v,
      weight: KEY_ATTRS.has(normalizeForMatch(key)) ? FIELD_WEIGHTS.keyAttr : FIELD_WEIGHTS.attr
    }))
  ]
    .map(({ text, weight }) => ({ text: normalizeForMatch(text), weight }))
    .filter(({ text }) => text);

  // The supplier data stores color under up to three attr keys at once
  // ("Цвет", "Название цвета", "color" - see attrs dump on any product), all
  // holding the same value. Scoring each attr separately meant one matched
  // color keyword was counted 2-3x over at keyAttr weight, letting color
  // (and, now that mount has two aliases too) alone drag completely
  // wrong-type products - a hook, a soap dish - to a score that looked like a
  // confident match. Collapsing fields that resolve to the identical
  // normalized text keeps every distinct signal but only once each.
  const seenText = new Map();
  for (const field of rawFields) {
    const existing = seenText.get(field.text);
    if (!existing || field.weight > existing.weight) seenText.set(field.text, field);
  }
  const fields = [...seenText.values()].map((field) => ({ ...field, stems: stemsOf(field.text) }));

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

  // "унитаз" vs "унитаза", "душевая" vs "душ" - the whole-word/stem matching
  // above is exact enough for scoring, but too strict to gate on: stemRu only
  // strips one suffix, so "душевая" reduces to "душев" while the product's
  // own word "душ" doesn't reduce any further, and they never compare equal
  // even though they share the same root. A same-root check just needs one
  // word to be a prefix of the other, which is true for ordinary Russian
  // inflection regardless of which form is longer.
  const typeWords = normalizeForMatch(typeKeyword || "").match(/[a-zа-я0-9]+/g)?.filter((w) => w.length >= 3) || [];
  const fieldWords = fields.flatMap((f) => f.text.match(/[a-zа-я0-9]+/g) || []);
  const typeMatched =
    typeWords.length === 0 ||
    typeWords.some((tw) =>
      fieldWords.some((fw) => {
        const [short, long] = tw.length <= fw.length ? [tw, fw] : [fw, tw];
        return short.length >= 3 && long.startsWith(short);
      })
    );

  // Color and mount are shared by huge swaths of a category (half the
  // catalog is chrome, wall-mounted), so on their own they aren't evidence
  // this is the same *kind* of object - they inflated a soap dish to a
  // "confident" match for a photo of a heated towel rail (a product line
  // this catalog doesn't carry at all). Requiring the component's own noun
  // ("полотенцесушитель", "унитаз"...) to land somewhere on the product
  // is what actually asserts "this is that kind of thing"; without it, no
  // amount of matching secondary attrs should count as a real match.
  if (!typeMatched) return 0;

  // A confirmed mount_type from the photo that lands in a *different* group
  // than the product's own "Установка"/"Тип монтажа" is a hard contradiction,
  // not a missing bonus - a deck-standing mixer can never be the concealed
  // one, no matter how well color/shape/brand line up. Only veto when both
  // sides are unambiguous: an untagged product or an unrecognized mount
  // phrase isn't evidence of anything, so it's left to score normally.
  if (mountType) {
    const wantGroups = mountGroupsOf(mountType);
    const productMountText = [
      product.attrs?.["Установка"],
      product.attrs?.["Тип монтажа"],
      product.attrs?.["Вид монтажа"],
      product.attrs?.["Монтаж"]
    ].filter(Boolean).join(" ");
    const haveGroups = mountGroupsOf(productMountText);
    if (wantGroups.length && haveGroups.length && !wantGroups.some((g) => haveGroups.includes(g))) {
      return 0;
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
  const candidates = (await Product.find(filter).limit(5000).lean())
    .filter((p) => !SPARE_PART_PRODUCT.test(p.name || ""));
  const keywords = [...(component.keywords || []), component.type, component.mount_type].filter(Boolean);

  // No "first N of the category regardless" fallback anymore: scoreProduct
  // now returns 0 whenever the component's own type never matched anything
  // (see its comment), which is exactly the case where this catalog simply
  // doesn't carry that product - e.g. a photo of a towel rail, a product
  // line this store doesn't stock. Showing unrelated category filler there
  // used to look like a confident answer; showing nothing is the honest one,
  // and the frontend already has a "not found" state for an empty list.
  return candidates
    .map((p) => ({ product: p, score: scoreProduct(p, keywords, component.type, component.mount_type) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { analyzeImage, findMatches, isConfigured };
