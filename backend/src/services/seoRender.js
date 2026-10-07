// Server-rendered <head> and above-the-fold content for crawlers.
//
// The site is a client-rendered SPA: before this existed, all ~1400 URLs in
// sitemap.xml returned byte-identical HTML with an empty <div id="root">, and
// every title/description/JSON-LD was written by utils/seo.ts only after React
// mounted and /api/catalog answered. Googlebot defers that second render pass
// to a queue a young domain rarely gets through, and Yandex — which matters
// more than Google in KZ — largely does not run it at all, so the whole
// catalog looked like one duplicated page.
//
// This is deliberately NOT full SSR: React is not executed here. We reuse the
// built index.html, swap in per-route metadata, and plant a plain-HTML summary
// of the page inside #root. createRoot() discards that subtree on mount, so
// the React app is unaffected and there is no hydration contract to keep in
// sync — the cost of a stale renderer here is a worse snippet, never a broken
// page. The same markup is what a user with slow JS sees first, so it is
// content, not cloaking.

const fs = require("fs");
const path = require("path");
const Product = require("../models/Product");
const { getRegistry } = require("./seoRegistry");
const { normalizeImageUrl } = require("../utils");

const SITE_URL = String(process.env.SITE_URL || "https://bathroomdesign.kz").replace(/\/+$/, "");
const DIST_DIR = path.resolve(
  process.env.FRONTEND_DIST || path.join(__dirname, "..", "..", "..", "frontend", "dist")
);

const SALON = {
  city: "Астана",
  street: "ул. Розы Баглановой, 2, ЖК Sezim Qala",
  phone: "+7 702 377 83 31",
  phoneHref: "+77023778331"
};

/** Internal links per listing page. The sitemap covers full discovery; this is
 *  about giving crawlers real paths into the catalog without a 1211-item page. */
const MAX_LISTED = 96;
const MAX_RELATED = 12;

const ACTIVE = { active: true, inStock: true };

// ---------------------------------------------------------------- template

let templateCache = null;

/** Drop the static SEO tags so per-route ones cannot end up duplicated.
 *  The LocalBusiness JSON-LD block is deliberately kept: it is site-wide. */
function stripTemplateSeo(html) {
  return html
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\r?\n?/i, "")
    .replace(/[ \t]*<meta\s+name="description"[^>]*>\r?\n?/gi, "")
    .replace(/[ \t]*<meta\s+name="keywords"[^>]*>\r?\n?/gi, "")
    .replace(/[ \t]*<meta\s+property="og:(?:title|description|type|url|image)"[^>]*>\r?\n?/gi, "")
    .replace(/[ \t]*<meta\s+name="twitter:(?:card|title|description|image)"[^>]*>\r?\n?/gi, "")
    .replace(/[ \t]*<link\s+rel="canonical"[^>]*>\r?\n?/gi, "")
    .replace(/[ \t]*<!--\s*TODO: replace with the real production domain[^>]*-->\r?\n?/gi, "");
}

function loadTemplate() {
  const file = path.join(DIST_DIR, "index.html");
  const stat = fs.statSync(file);
  // Re-read after a deploy without restarting pm2.
  if (templateCache && templateCache.mtimeMs === stat.mtimeMs) return templateCache.html;
  const html = stripTemplateSeo(fs.readFileSync(file, "utf8"));
  templateCache = { mtimeMs: stat.mtimeMs, html };
  return html;
}

function templateExists() {
  try {
    return fs.statSync(path.join(DIST_DIR, "index.html")).isFile();
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ escaping

const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);

/** JSON-LD sits inside <script>, where a literal "</script>" in any string
 *  value would terminate the block early. */
const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

const abs = (urlPath) => {
  const v = String(urlPath || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `${SITE_URL}${v.startsWith("/") ? "" : "/"}${v}`;
};

const clip = (s, max) => {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
};

/**
 * Titles are built as "<subject> — купить в Астане | Bathroom Design".
 * Clipping the finished string is wrong: product names run long, so the tail
 * gets eaten and the result reads "… — купить в А…", losing both the brand
 * and the city term the page is meant to rank for. Clip only the subject and
 * always keep the suffix whole. No overall cap — search engines index the
 * full title and merely truncate it for display, so a slightly long title
 * costs nothing while a mangled one costs the keyword.
 */
const titleWithSuffix = (subject, suffix) => `${clip(subject, 85)}${suffix}`;

// -------------------------------------------------------------- body pieces

const shell = (inner) =>
  `<div style="max-width:1180px;margin:0 auto;padding:28px 20px;` +
  `font-family:Roboto,Arial,sans-serif;color:#1D2B49;line-height:1.6">${inner}</div>`;

const h1 = (text) =>
  `<h1 style="font-family:Poppins,Arial,sans-serif;font-size:28px;margin:0 0 12px">${esc(text)}</h1>`;

const para = (text) => `<p style="margin:0 0 16px;color:#44506b">${esc(text)}</p>`;

function linkList(items, heading) {
  if (!items.length) return "";
  const lis = items
    .map(
      (i) =>
        `<li style="margin:0 0 6px"><a href="${esc(i.href)}" style="color:#1D2B49">${esc(i.text)}</a></li>`
    )
    .join("");
  return (
    (heading ? `<h2 style="font-size:19px;margin:24px 0 10px">${esc(heading)}</h2>` : "") +
    `<ul style="list-style:none;padding:0;margin:0;columns:2;column-gap:32px">${lis}</ul>`
  );
}

function contactBlock() {
  return (
    `<p style="margin:24px 0 0;color:#44506b">Салон в ${esc(SALON.city)}: ${esc(SALON.street)}. ` +
    `Телефон <a href="tel:${esc(SALON.phoneHref)}" style="color:#1D2B49">${esc(SALON.phone)}</a>. ` +
    `Ежедневно 10:00–18:00.</p>`
  );
}

const productHref = (p) => `/product/${String(p._id || p.id)}`;

const COLOR_KEY = /^(color|цвет|название цвета|отделка|покрытие)$/i;

/** The finish, e.g. "Матовая состаренная бронза". */
function productColor(p) {
  for (const [k, v] of Object.entries(p.attrs || {})) {
    if (COLOR_KEY.test(String(k).trim()) && String(v ?? "").trim()) return String(v).trim();
  }
  return "";
}

const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The catalog spells "Чёрный" in the attribute and "черный" in the name
 *  (and vice versa), so ё and е have to match interchangeably. */
function nameContains(name, token) {
  const t = String(token || "").trim();
  if (!t) return true;
  return new RegExp(escapeRe(t).replace(/[её]/gi, "[её]"), "i").test(name);
}

/**
 * A name alone does not identify a product here: the catalog carries the same
 * model in many finishes under one name — 2613 active products share only
 * 2413 distinct names, and "Однорычажный Смеситель для раковины" alone covers
 * 17 of them. Titles built from the name only would hand search engines
 * hundreds of exact-duplicate pages.
 *
 * Only genuinely missing qualifiers get appended: plenty of names already
 * carry the brand, SKU and finish inline ("Держатель для полотенец Allen Brau
 * Infinity 6.21011-00 хром"), and re-appending them produced a title that was
 * both redundant and long enough to be truncated.
 */
function productSubject(p) {
  const name = String(p.name || "").trim();
  const parts = [name];

  const color = productColor(p);
  if (color && !nameContains(name, color)) parts.push(color);
  if (p.brand && !nameContains(name, p.brand)) parts.push(p.brand);
  // The SKU is a last-resort disambiguator — ugly in a title, so only when
  // nothing more readable set this variant apart.
  if (parts.length === 1 && p.sku && !nameContains(name, p.sku)) parts.push(p.sku);

  return parts.join(", ");
}

const productLabel = (p) => productSubject(p) || String(p.name || "Товар");

// ------------------------------------------------------------------ queries

// `attrs` is needed for the finish that distinguishes same-named variants
// (see productSubject), so listing pages cannot select names alone.
const LIST_FIELDS = "_id name brand sku category_id attrs";

async function listProducts(filter, limit) {
  return Product.find(filter).select(LIST_FIELDS).sort({ name: 1 }).limit(limit).lean();
}

// -------------------------------------------------------------------- pages

async function homePage() {
  const { categories, brands } = await getRegistry();
  const total = categories.reduce((s, c) => s + c.count, 0);

  return {
    title: "Bathroom Design — салон сантехники в Астане: смесители, ванны, душевые системы",
    description:
      `Салон сантехники Bathroom Design в Астане, ${SALON.street}. ` +
      `${total} товаров в наличии: смесители, ванны, душевые системы, инсталляции, ` +
      `керамика и аксессуары. Бренды Allen Brau, Bugnatese, Hans, Raglo. Доставка по Казахстану.`,
    canonical: `${SITE_URL}/`,
    ogType: "website",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Bathroom Design",
        url: `${SITE_URL}/`,
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE_URL}/catalog?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      }
    ],
    body: shell(
      h1("Bathroom Design — салон сантехники в Астане") +
        para(
          `Смесители, ванны, душевые системы, инсталляции, керамика и аксессуары для ванной комнаты. ` +
            `${total} позиций в каталоге, подбор и доставка по Казахстану.`
        ) +
        linkList(
          categories.map((c) => ({ href: `/catalog/${c.slug}`, text: `${c.title} (${c.count})` })),
          "Категории каталога"
        ) +
        linkList(
          brands.slice(0, 24).map((b) => ({ href: `/brand/${b.slug}`, text: b.name })),
          "Бренды"
        ) +
        contactBlock()
    )
  };
}

async function categoryPage(cat) {
  const items = await listProducts({ ...ACTIVE, category_id: cat.category_id }, MAX_LISTED);
  const { categories } = await getRegistry();
  const canonical = `${SITE_URL}/catalog/${cat.slug}`;

  const title = cat.seoTitle || titleWithSuffix(cat.title, " — купить в Астане | Bathroom Design");
  const description =
    cat.seoDescription ||
    `${cat.title} в Астане — ${cat.count} товаров в салоне Bathroom Design, ${SALON.street}. ` +
      `Консультация, подбор и доставка по Казахстану. Телефон ${SALON.phone}.`;

  return {
    title,
    description: clip(description, 300),
    canonical,
    ogType: "website",
    jsonLd: [
      breadcrumbs([
        { name: "Главная", item: `${SITE_URL}/` },
        { name: "Каталог", item: `${SITE_URL}/catalog` },
        { name: cat.title, item: canonical }
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: cat.title,
        url: canonical,
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: cat.count,
          itemListElement: items.slice(0, 30).map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: abs(productHref(p)),
            name: p.name
          }))
        }
      }
    ],
    body: shell(
      `<nav style="font-size:13px;color:#7b86a0;margin-bottom:10px">` +
        `<a href="/" style="color:#7b86a0">Главная</a> / ` +
        `<a href="/catalog" style="color:#7b86a0">Каталог</a> / ${esc(cat.title)}</nav>` +
        h1(`${cat.title} — купить в Астане`) +
        para(
          `${cat.count} товаров в категории «${cat.title}». Салон Bathroom Design, ${SALON.street}.`
        ) +
        linkList(items.map((p) => ({ href: productHref(p), text: productLabel(p) }))) +
        linkList(
          categories
            .filter((c) => c.slug !== cat.slug)
            .map((c) => ({ href: `/catalog/${c.slug}`, text: c.title })),
          "Другие категории"
        ) +
        contactBlock()
    )
  };
}

async function catalogPage() {
  const { categories, brands } = await getRegistry();
  const total = categories.reduce((s, c) => s + c.count, 0);
  const canonical = `${SITE_URL}/catalog`;

  return {
    title: "Каталог сантехники в Астане — смесители, ванны, душевые | Bathroom Design",
    description:
      `Полный каталог сантехники Bathroom Design: ${total} товаров в ${categories.length} категориях. ` +
      `Смесители, ванны, душевые системы, инсталляции, керамика. Астана, ${SALON.street}.`,
    canonical,
    ogType: "website",
    jsonLd: [
      breadcrumbs([
        { name: "Главная", item: `${SITE_URL}/` },
        { name: "Каталог", item: canonical }
      ])
    ],
    body: shell(
      h1("Каталог сантехники") +
        para(`${total} товаров в ${categories.length} категориях. Подбор и доставка по Казахстану.`) +
        linkList(
          categories.map((c) => ({ href: `/catalog/${c.slug}`, text: `${c.title} (${c.count})` })),
          "Категории"
        ) +
        linkList(
          brands.map((b) => ({ href: `/brand/${b.slug}`, text: `${b.name} (${b.count})` })),
          "Бренды"
        ) +
        contactBlock()
    )
  };
}

async function brandPage(brand) {
  // $in over every raw spelling, not an equality on the display name — see
  // seoRegistry.js#groupBrands: the same brand exists under several spellings
  // and matching only the canonical one would hide most of its range.
  const items = await listProducts({ ...ACTIVE, brand: { $in: brand.variants } }, MAX_LISTED);
  const { brands } = await getRegistry();
  const canonical = `${SITE_URL}/brand/${brand.slug}`;

  // Which categories this brand actually spans — makes the copy specific
  // ("смесители и душевые системы") instead of generic boilerplate.
  const catTitles = [...new Set(items.map((p) => p.category_id).filter(Boolean))];
  const { categoryById } = await getRegistry();
  const spans = catTitles
    .map((id) => categoryById.get(id)?.title)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ")
    .toLowerCase();

  return {
    title: titleWithSuffix(brand.name, " — сантехника в Астане | Bathroom Design"),
    description: clip(
      `${brand.name} в Астане — ${brand.count} товаров в наличии в салоне Bathroom Design, ` +
        `${SALON.street}${spans ? `. В ассортименте: ${spans}` : ""}. ` +
        `Консультация и доставка по Казахстану, телефон ${SALON.phone}.`,
      300
    ),
    canonical,
    ogType: "website",
    jsonLd: [
      breadcrumbs([
        { name: "Главная", item: `${SITE_URL}/` },
        { name: "Бренды", item: `${SITE_URL}/catalog` },
        { name: brand.name, item: canonical }
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${brand.name} — сантехника`,
        url: canonical,
        about: { "@type": "Brand", name: brand.name },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: brand.count,
          itemListElement: items.slice(0, 30).map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: abs(productHref(p)),
            name: p.name
          }))
        }
      }
    ],
    body: shell(
      `<nav style="font-size:13px;color:#7b86a0;margin-bottom:10px">` +
        `<a href="/" style="color:#7b86a0">Главная</a> / ` +
        `<a href="/catalog" style="color:#7b86a0">Каталог</a> / ${esc(brand.name)}</nav>` +
        h1(`${brand.name} — сантехника в Астане`) +
        para(
          `${brand.count} товаров бренда ${brand.name} в салоне Bathroom Design, ${SALON.street}` +
            `${spans ? `. В ассортименте: ${spans}` : ""}.`
        ) +
        linkList(items.map((p) => ({ href: productHref(p), text: productLabel(p) }))) +
        linkList(
          brands.filter((b) => b.slug !== brand.slug).map((b) => ({ href: `/brand/${b.slug}`, text: b.name })),
          "Другие бренды"
        ) +
        contactBlock()
    )
  };
}

async function productPage(product) {
  const { categoryById } = await getRegistry();
  const cat = categoryById.get(product.category_id);
  const canonical = `${SITE_URL}/product/${String(product._id)}`;
  const image = abs(normalizeImageUrl(product.image || (product.images || [])[0]));

  const attrEntries = Object.entries(product.attrs || {})
    .filter(([k, v]) => k && String(v ?? "").trim())
    .slice(0, 20);

  const specLine = attrEntries
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const description =
    clip(product.description, 300) ||
    clip(
      `${product.name}${productColor(product) ? `, ${productColor(product)}` : ""}` +
        `${product.brand ? ` — ${product.brand}` : ""}` +
        `${cat ? `, категория «${cat.title}»` : ""}` +
        `${product.sku ? `, артикул ${product.sku}` : ""}` +
        `${specLine ? `. ${specLine}` : ""}. ` +
        `В наличии в салоне Bathroom Design, Астана, ${SALON.street}. Телефон ${SALON.phone}.`,
      300
    );

  const related = cat
    ? await listProducts(
        { ...ACTIVE, category_id: product.category_id, _id: { $ne: product._id } },
        MAX_RELATED
      )
    : [];

  const crumbs = [
    { name: "Главная", item: `${SITE_URL}/` },
    { name: "Каталог", item: `${SITE_URL}/catalog` }
  ];
  if (cat) crumbs.push({ name: cat.title, item: `${SITE_URL}/catalog/${cat.slug}` });
  crumbs.push({ name: product.name, item: canonical });

  const specTable = attrEntries.length
    ? `<h2 style="font-size:19px;margin:24px 0 10px">Характеристики</h2>` +
      `<table style="border-collapse:collapse;font-size:14px"><tbody>` +
      attrEntries
        .map(
          ([k, v]) =>
            `<tr><th style="text-align:left;padding:4px 20px 4px 0;font-weight:500;color:#7b86a0">` +
            `${esc(k)}</th><td style="padding:4px 0">${esc(v)}</td></tr>`
        )
        .join("") +
      `</tbody></table>`
    : "";

  return {
    title: titleWithSuffix(productSubject(product), " — купить в Астане | Bathroom Design"),
    description,
    canonical,
    ogType: "product",
    ogImage: image,
    jsonLd: [
      breadcrumbs(crumbs),
      pruned({
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        sku: product.sku || undefined,
        mpn: product.sku || undefined,
        category: cat?.title,
        brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
        image: image ? [image] : undefined,
        description,
        offers: {
          "@type": "Offer",
          url: canonical,
          priceCurrency: "KZT",
          // The whole catalog is price-on-request; schema.org models that as
          // price 0 + a PriceSpecification-free offer would be invalid, so
          // availability alone carries the signal.
          ...(product.prices?.retail ? { price: product.prices.retail } : { price: "0" }),
          availability: product.inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/PreOrder",
          seller: { "@type": "Organization", name: "Bathroom Design" }
        }
      })
    ],
    body: shell(
      `<nav style="font-size:13px;color:#7b86a0;margin-bottom:10px">` +
        crumbs
          .slice(0, -1)
          .map((c) => `<a href="${esc(c.item)}" style="color:#7b86a0">${esc(c.name)}</a>`)
          .join(" / ") +
        ` / ${esc(product.name)}</nav>` +
        h1(productColor(product) ? `${product.name}, ${productColor(product)}` : product.name) +
        (image
          ? `<img src="${esc(image)}" alt="${esc(product.name)}" width="420" ` +
            `style="max-width:100%;height:auto;border-radius:12px;margin:0 0 16px" loading="eager">`
          : "") +
        para(
          [
            product.brand && `Бренд: ${product.brand}`,
            product.sku && `Артикул: ${product.sku}`,
            cat && `Категория: ${cat.title}`
          ]
            .filter(Boolean)
            .join(" · ")
        ) +
        (product.description ? para(product.description) : "") +
        specTable +
        `<p style="margin:20px 0 0">Цена по запросу — ` +
        `<a href="tel:${esc(SALON.phoneHref)}" style="color:#1D2B49">${esc(SALON.phone)}</a></p>` +
        linkList(
          related.map((p) => ({ href: productHref(p), text: productLabel(p) })),
          cat ? `Другие товары: ${cat.title}` : "Похожие товары"
        ) +
        contactBlock()
    )
  };
}

function staticPage({ slug, title, description, heading, text }) {
  const canonical = `${SITE_URL}/${slug}`;
  return {
    title,
    description,
    canonical,
    ogType: "website",
    jsonLd: [
      breadcrumbs([
        { name: "Главная", item: `${SITE_URL}/` },
        { name: heading, item: canonical }
      ])
    ],
    body: shell(h1(heading) + para(text) + contactBlock())
  };
}

const STATIC_PAGES = {
  designers: {
    slug: "designers",
    title: "Дизайнеры интерьера ванных комнат в Астане | Bathroom Design",
    description:
      `Дизайнеры интерьера, работающие с салоном Bathroom Design в Астане: портфолио, опыт, ` +
      `контакты. Помощь в подборе сантехники и планировке ванной комнаты.`,
    heading: "Наши дизайнеры",
    text:
      "Дизайнеры интерьера, с которыми мы работаем: портфолио проектов ванных комнат, опыт " +
      "и прямые контакты. Запишитесь на консультацию по подбору сантехники и планировке."
  },
  brigades: {
    slug: "brigades",
    title: "Монтаж сантехники в Астане — строительные бригады | Bathroom Design",
    description:
      `Проверенные строительные бригады для монтажа сантехники в Астане: установка инсталляций, ` +
      `душевых систем, смесителей и ванн. Портфолио работ и контакты.`,
    heading: "Строительные бригады",
    text:
      "Проверенные бригады для монтажа сантехники в Астане: установка инсталляций и подвесных " +
      "унитазов, душевых систем, смесителей, ванн и полотенцесушителей. Портфолио и контакты мастеров."
  },
  warranty: {
    slug: "warranty",
    title: "Гарантия и сервис на сантехнику | Bathroom Design Астана",
    description:
      "Условия гарантии и сервисного обслуживания сантехники, купленной в салоне Bathroom Design " +
      "в Астане: сроки, порядок обращения, обмен и возврат.",
    heading: "Гарантия и сервис",
    text:
      "Условия гарантии на сантехнику из салона Bathroom Design: гарантийные сроки производителей, " +
      "порядок обращения в сервис, обмен и возврат товара."
  }
};

function notFoundPage(pathname) {
  return {
    status: 404,
    noindex: true,
    title: "Страница не найдена | Bathroom Design",
    description: "Такой страницы нет. Вернитесь на главную или откройте каталог сантехники Bathroom Design.",
    canonical: "",
    body: shell(
      h1("Страница не найдена") +
        para(`Адрес ${pathname} не существует. Откройте каталог или вернитесь на главную.`) +
        linkList([
          { href: "/", text: "Главная" },
          { href: "/catalog", text: "Каталог сантехники" }
        ])
    )
  };
}

/** Routes that exist for users but must never rank: cart, the upload tool,
 *  the admin panel. robots.txt already disallows them; this is the belt-and-
 *  braces for crawlers that ignore it. */
function privatePage(title) {
  return {
    noindex: true,
    title: `${title} | Bathroom Design`,
    description: "",
    canonical: "",
    body: ""
  };
}

// ------------------------------------------------------------------ helpers

const breadcrumbs = (crumbs) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name,
    item: c.item
  }))
});

/** schema.org validators flag explicit nulls, and JSON.stringify keeps
 *  `undefined` out of objects but not out of nested ones we build inline. */
function pruned(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => (v === undefined || v === null ? undefined : v)));
}

// ------------------------------------------------------------------- resolve

async function resolvePage(pathname, query) {
  const clean = pathname.replace(/\/+$/, "") || "/";

  if (clean === "/") return homePage();
  if (clean === "/catalog") {
    // Legacy ?cat=<cyrillic id> links are still in the wild and in old
    // sitemaps; serve them as the category page they mean, with the canonical
    // pointing at the new path so the duplicate consolidates.
    const catParam = String(query?.cat || "").trim();
    if (catParam && catParam !== "all") {
      const { categoryById, categoryBySlug } = await getRegistry();
      const cat = categoryById.get(catParam) || categoryBySlug.get(catParam);
      if (cat) return categoryPage(cat);
    }
    return catalogPage();
  }

  const catMatch = clean.match(/^\/catalog\/([^/]+)$/);
  if (catMatch) {
    const { categoryBySlug } = await getRegistry();
    const cat = categoryBySlug.get(decodeURIComponent(catMatch[1]).toLowerCase());
    return cat ? categoryPage(cat) : notFoundPage(clean);
  }

  const brandMatch = clean.match(/^\/brand\/([^/]+)$/);
  if (brandMatch) {
    const { brandBySlug } = await getRegistry();
    const brand = brandBySlug.get(decodeURIComponent(brandMatch[1]).toLowerCase());
    return brand ? brandPage(brand) : notFoundPage(clean);
  }

  const productMatch = clean.match(/^\/product\/([a-f0-9]{24})$/i);
  if (productMatch) {
    const product = await Product.findOne({ _id: productMatch[1], active: true }).lean();
    return product ? productPage(product) : notFoundPage(clean);
  }

  const staticKey = clean.slice(1);
  if (STATIC_PAGES[staticKey]) return staticPage(STATIC_PAGES[staticKey]);

  if (clean === "/cart") return privatePage("Корзина");
  if (clean === "/visual-search") return privatePage("Поиск по фото");
  if (clean === "/admin" || clean.startsWith("/admin/")) return privatePage("Админпанель");

  return notFoundPage(clean);
}

// -------------------------------------------------------------------- render

function buildHead(page) {
  const title = page.title || "Bathroom Design";
  const parts = [`<title>${esc(title)}</title>`];

  if (page.description) {
    parts.push(`<meta name="description" content="${esc(page.description)}">`);
    parts.push(`<meta property="og:description" content="${esc(page.description)}">`);
    parts.push(`<meta name="twitter:description" content="${esc(page.description)}">`);
  }

  parts.push(`<meta property="og:title" content="${esc(title)}">`);
  parts.push(`<meta name="twitter:title" content="${esc(title)}">`);
  parts.push(`<meta property="og:type" content="${esc(page.ogType || "website")}">`);
  parts.push(`<meta name="twitter:card" content="summary_large_image">`);

  if (page.canonical) {
    parts.push(`<link rel="canonical" href="${esc(page.canonical)}">`);
    parts.push(`<meta property="og:url" content="${esc(page.canonical)}">`);
  }
  if (page.ogImage) {
    parts.push(`<meta property="og:image" content="${esc(page.ogImage)}">`);
    parts.push(`<meta name="twitter:image" content="${esc(page.ogImage)}">`);
  }
  if (page.noindex) parts.push(`<meta name="robots" content="noindex,follow">`);

  for (const data of page.jsonLd || []) parts.push(jsonLd(data));

  return parts.join("\n");
}

async function renderPage(pathname, query) {
  const page = await resolvePage(pathname, query);
  const html = loadTemplate()
    .replace("</head>", `${buildHead(page)}\n</head>`)
    .replace('<div id="root"></div>', `<div id="root">${page.body || ""}</div>`);

  return { status: page.status || 200, html };
}

module.exports = { renderPage, templateExists, SITE_URL, SALON, MAX_LISTED };
