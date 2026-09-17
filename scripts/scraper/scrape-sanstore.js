// Scrapes sanstore.kz into one .xlsx per category (Номенклатура, Артикул,
// Бренд, Коллекция, Подкатегория, Цвет, Характеристики, Описание,
// Картинка 1..N).
//
// The site's own pagination is broken sitewide (?PAGEN_2=N always returns
// the same first page, confirmed both via direct navigation and via
// clicking the real pagination link - not a Playwright quirk, a real bug on
// sanstore.kz) and every listing silently caps at 100 items. Getting the
// full catalog works around this by slicing each category with the site's
// OWN working filters instead of pagination:
//   1. one request per brand (?arrFilter_252=<id>) - brand IS a working
//      filter, just each slice can itself still hit the 100 cap for large
//      brands (Grohe, Hansgrohe, ESKO, ...);
//   2. any slice that hits exactly 100 gets recursively split by price
//      range (?arrFilter_P7_MIN=&arrFilter_P7_MAX=), which reliably drops
//      each half under 100 within a few levels.
// This is a real, confirmed limitation of the source site, not a shortcut -
// see the conversation for the price-split verification (e.g. ESKO/смесители
// went from a capped 100 to a true 324 once split by price).
//
// Usage:
//   node scrape-sanstore.js <category-slug> [--out=name] [--headless]
//
// Example:
//   node scrape-sanstore.js smesiteli --out=sanstore-smesiteli --headless
//   node scrape-sanstore.js sistemy_installyatsii --out=sanstore-installyatsii --headless

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BASE = 'https://sanstore.kz';
const OUT_DIR = path.join(__dirname, 'out');
const REQUEST_DELAY_MS = 700;
const RETRIES_PER_PRODUCT = 3;
const PRICE_MAX = 3000000;
// Under sustained load the site serves an error page (still HTTP 200, so
// page.goto() "succeeds") with an h1 like "Service Temporarily Unavailable" -
// without this check that garbage silently gets saved as if it were real
// product data instead of triggering a retry.
const ERROR_PAGE_RE = /service temporarily unavailable|too many requests|bad gateway|503|access denied/i;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function isProductHref(href, slug) {
  if (!href || href.includes('?')) return false;
  const parts = href.replace(/^\/+|\/+$/g, '').split('/');
  return parts.length === 3 && parts[0] === 'catalog' && parts[1] === slug;
}

async function fetchLinks(page, slug, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const url = `${BASE}/catalog/${slug}/?${qs}&set_filter=Y`;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(400);
      const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));
      return new Set(links.filter((h) => isProductHref(h, slug)));
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

async function collectWithPriceSplit(page, slug, extraParams, min, max, depth, log) {
  const links = await fetchLinks(page, slug, { ...extraParams, arrFilter_P7_MIN: min, arrFilter_P7_MAX: max });
  if (links.size < 100 || max - min < 50 || depth > 18) return links;
  const mid = Math.floor((min + max) / 2);
  const left = await collectWithPriceSplit(page, slug, extraParams, min, mid, depth + 1, log);
  const right = await collectWithPriceSplit(page, slug, extraParams, mid + 1, max, depth + 1, log);
  return new Set([...left, ...right]);
}

async function getBrands(page, slug) {
  await page.goto(`${BASE}/catalog/${slug}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li label.bx_filter_param_label'));
    return items
      .map((l) => ({ id: (l.getAttribute('for') || '').replace(/^all_/, '').replace(/^arrFilter_252_/, ''), text: l.textContent.trim() }))
      .filter((b) => b.text && b.text !== 'Все');
  });
}

// Collects every product link in a category via price-range slicing alone
// (brand-agnostic). Brand filtering was tried first but turned out to miss
// most of the catalog - most products here simply have no brand facet value
// set, so per-brand slicing (781 for "Смесители") badly undercounts the true
// total (2418, confirmed by this price-only method) - price-range slicing
// doesn't depend on that facet being populated at all.
async function collectCategoryLinks(page, slug, log) {
  const links = await collectWithPriceSplit(page, slug, {}, 0, PRICE_MAX, 0, log);
  return links;
}

// Brand isn't in a dedicated DOM field on the product page, but it's always
// part of the title (e.g. "... ESKO Orlando OL25S") - match against the
// category's own known brand list (longest name first, so "Jacob Delafon"
// wins over a shorter accidental substring match).
function detectBrand(name, brandNames) {
  const sorted = [...brandNames].sort((a, b) => b.length - a.length);
  for (const b of sorted) {
    const re = new RegExp(`(^|[^a-zа-я0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zа-я0-9]|$)`, 'i');
    if (re.test(name)) return b;
  }
  return '';
}

// Small spare-part/accessory pages (кран-буксы, аэраторы, лейки...) often
// have no "Артикул:" label on the page at all - the code is only visible as
// a token inside the product name itself, e.g. "... VODA VRBZ20" (usually
// trailing, sometimes leading for Axor/Hansgrohe-style listings like
// "18072000 display rough-in kit"). A code-like token is short, has at
// least one digit, and is free of lowercase letters (rules out ordinary
// words while matching "VRBZ20", "37312-624/1B-1", "01700180", etc).
function extractArticleFromName(name) {
  const isCodeLike = (t) => t.length >= 4 && t.length <= 24 && /\d/.test(t) && /^[A-ZА-Я0-9][A-Z0-9\-/.]*$/.test(t);
  const tokens = name.trim().split(/\s+/).map((t) => t.replace(/^[(,]+|[),.]+$/g, ''));
  if (!tokens.length) return '';
  if (isCodeLike(tokens[tokens.length - 1])) return tokens[tokens.length - 1];
  if (isCodeLike(tokens[0])) return tokens[0];
  const candidates = tokens.filter(isCodeLike);
  return candidates.length ? candidates.sort((a, b) => b.length - a.length)[0] : '';
}

function cleanArticle(raw) {
  return String(raw || '').split('<')[0].trim();
}

async function extractProduct(page, url, brandNames) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(300);

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  if (ERROR_PAGE_RE.test(bodyText)) {
    throw new Error(`error page served instead of product (${bodyText.slice(0, 60).trim()})`);
  }

  const data = await page.evaluate(() => {
    const name = document.querySelector('h1')?.textContent?.trim() || '';
    const artMatch = document.body.innerText.match(/Артикул[:\s]*([^\n]+)/i);
    const article = artMatch ? artMatch[1].trim() : '';
    if (!name) throw new Error('empty h1 - likely a failed/partial page load');

    const dedup = new Map();
    Array.from(document.querySelectorAll('table tr')).forEach((tr) => {
      const key = tr.querySelector('td.type span, td.type')?.textContent?.trim();
      const value = tr.querySelector('td.value')?.textContent?.trim();
      if (key && value && !dedup.has(key)) dedup.set(key, value);
    });

    const description = document.querySelector('[class*="description" i]')?.textContent?.trim() || '';

    const container = document.querySelector('.product-detail');
    const images = container
      ? Array.from(container.querySelectorAll('img'))
          .map((img) => img.getAttribute('data-src') || img.getAttribute('src'))
          .filter((s) => s && /^\/upload\/iblock\//.test(s))
      : [];

    const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb a, [class*="breadcrumb" i] a')).map((a) => a.textContent.trim());

    return { name, article, characteristics: Array.from(dedup.entries()), description, images: Array.from(new Set(images)), breadcrumbs };
  });

  data.images = data.images.map((src) => BASE + src);
  data.brand = detectBrand(data.name, brandNames);
  data.article = cleanArticle(data.article) || extractArticleFromName(data.name);
  return data;
}

function shortenDescription(text, maxLen = 260) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

function guessSubcategory(name) {
  const s = name.toLowerCase();
  if (/биде/.test(s)) return 'Смесители для биде';
  if (/гигиеническ.*душ/.test(s)) return 'Смесители с гигиеническим душем';
  if (/раковин/.test(s)) return 'Смесители для раковины';
  if (/\bванн/.test(s)) return 'Смесители для ванны';
  if (/кухн/.test(s)) return 'Смесители для кухни';
  if (/термостат/.test(s)) return 'Смесители с термостатом';
  if (/\bдуш/.test(s)) return 'Смесители для душа';
  return '';
}

function buildRow(product) {
  const find = (re) => {
    const hit = product.characteristics.find(([k]) => re.test(k));
    return hit ? hit[1].trim() : '';
  };
  const color = find(/цвет/i);
  const characteristicsText = product.characteristics.map(([k, v]) => `${k}: ${v}`).join('\n');

  return {
    'Номенклатура': product.name,
    'Артикул': product.article,
    'Бренд': product.brand,
    'Коллекция': '',
    'Подкатегория': guessSubcategory(product.name),
    'Цвет': color,
    'Характеристики': characteristicsText,
    'Описание': shortenDescription(product.description),
    images: product.images
  };
}

async function writeXlsx(rows, filePath) {
  const maxImages = rows.reduce((m, r) => Math.max(m, r.images.length), 1);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Товары');

  const headers = ['Номенклатура', 'Артикул', 'Бренд', 'Коллекция', 'Подкатегория', 'Цвет', 'Характеристики', 'Описание'];
  for (let i = 1; i <= maxImages; i++) headers.push(`Картинка ${i}`);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    const values = [
      row['Номенклатура'], row['Артикул'], row['Бренд'], row['Коллекция'], row['Подкатегория'], row['Цвет'],
      row['Характеристики'], row['Описание']
    ];
    for (let i = 0; i < maxImages; i++) values.push(row.images[i] || '');
    ws.addRow(values);
  }

  ws.columns.forEach((col, idx) => { col.width = idx === 6 ? 60 : idx === 7 ? 40 : 24; });
  ws.getColumn(7).alignment = { wrapText: true };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await wb.xlsx.writeFile(filePath);
}

async function main() {
  const args = process.argv.slice(2);
  const headless = args.includes('--headless');
  const outArg = args.find((a) => a.startsWith('--out='));
  const slug = args.find((a) => !a.startsWith('--'));
  const outName = outArg ? outArg.slice('--out='.length) : `sanstore-${slug}`;

  if (!slug) {
    console.error('Использование: node scrape-sanstore.js <category-slug> [--out=имя] [--headless]');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const checkpointPath = path.join(OUT_DIR, `${outName}.json`);
  const xlsxPath = path.join(OUT_DIR, `${outName}.xlsx`);

  let scraped = {};
  if (fs.existsSync(checkpointPath)) {
    scraped = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    console.log(`Резюме: уже есть ${Object.keys(scraped).length} товаров в чекпоинте ${outName}.json`);
  }

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 30 });
  const page = await browser.newPage();

  const brandList = (await getBrands(page, slug)).map((b) => b.text);
  console.log(`Известные бренды категории (${brandList.length}): ${brandList.join(', ')}`);

  console.log(`Собираю ссылки на товары для категории "${slug}"...`);
  const linkSet = await collectCategoryLinks(page, slug, (m) => console.log(m));
  console.log(`Всего уникальных товаров: ${linkSet.size}`);

  const failed = [];
  let done = 0;
  for (const href of linkSet) {
    const url = href.startsWith('http') ? href : BASE + href;
    done++;
    if (scraped[url]) continue;

    let attempt = 0;
    let ok = false;
    while (attempt <= RETRIES_PER_PRODUCT && !ok) {
      try {
        const data = await extractProduct(page, url, brandList);
        scraped[url] = { ...data, url };
        ok = true;
      } catch (e) {
        attempt++;
        if (attempt > RETRIES_PER_PRODUCT) {
          console.log(`  ! не удалось: ${url} (${e.message})`);
          failed.push(url);
        } else {
          await sleep(500);
        }
      }
    }

    if (done % 20 === 0 || done === linkSet.size) console.log(`  ${done}/${linkSet.size} обработано`);
    fs.writeFileSync(checkpointPath, JSON.stringify(scraped, null, 2));
    await sleep(REQUEST_DELAY_MS);
  }

  const rows = Object.values(scraped).map((p) => buildRow(p));
  await writeXlsx(rows, xlsxPath);
  console.log(`Готово: ${rows.length} товаров -> ${xlsxPath}`);
  if (failed.length) console.log(`Не удалось получить ${failed.length} товаров`);

  await browser.close();
}

module.exports = { buildRow, writeXlsx, extractArticleFromName, cleanArticle, guessSubcategory };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
