// Single source of truth for URL slugs.
//
// Category ids and brand names are Cyrillic free text ("смесители",
// "Смесители для раковины"). Used raw in a URL they become percent-encoded
// mojibake (/catalog?cat=%D1%81%D0%BC...), which both crawlers and humans
// handle badly. Everything that builds a public URL — the sitemap, the SSR
// renderer and the API payloads the frontend links from — goes through here,
// so the frontend never slugifies anything itself and the two sides cannot
// drift apart.

const RU_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya"
};

// Note: utils.js has its own `slugify` that preserves Cyrillic — that one
// builds internal product keys, not URLs. These two must not be swapped.
function urlSlug(input) {
  const lower = String(input || "").toLowerCase().trim();
  let out = "";

  for (const ch of lower) {
    if (Object.prototype.hasOwnProperty.call(RU_MAP, ch)) out += RU_MAP[ch];
    else if (ch >= "a" && ch <= "z") out += ch;
    else if (ch >= "0" && ch <= "9") out += ch;
    else out += "-";
  }

  return out.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Slugs must be unique per namespace or two categories collapse onto one URL.
 * Collisions are resolved by appending -2, -3… in the caller's iteration
 * order, which is stable because callers sort before building the map.
 */
function uniqueSlugger() {
  const taken = new Set();

  return (value, fallback) => {
    const base = urlSlug(value) || urlSlug(fallback) || "item";
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    taken.add(slug);
    return slug;
  };
}

module.exports = { urlSlug, uniqueSlugger };
