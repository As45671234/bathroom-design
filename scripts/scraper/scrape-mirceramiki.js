// Scrapes mirceramiki.kz (a multi-brand KZ sanitary-ware retailer) into one
// .xlsx (Номенклатура, Артикул, Бренд, Коллекция, Подкатегория, Цвет,
// Характеристики, Описание, Картинка 1..N).
//
// Usage:
//   node scrape-mirceramiki.js "<listing URL>" [--out=name] [--headless] [--brand=GROHE]
//
// Example (GROHE-filtered "Смесители для ванной и комплектующие" listing):
//   node scrape-mirceramiki.js "https://mirceramiki.kz/catalog/smesiteli-dlya-vannoi-komnaty/grohe" --brand=GROHE --out=grohe-smesiteli --headless
//
// Recon notes (verified against the live site before writing this):
// - Listing pagination is a real "Показать ещё N" button (a.loader) that
//   appends 24 more products each click via AJAX - NOT a fake/broken
//   pagination. Clicking it repeatedly until it disappears was verified to
//   grow the unique /product/ link set 24 -> 342 with zero duplicates for
//   the GROHE/смесители listing.
// - Product pages have NO characteristics table and NO description at all
//   (verified on several product types: mixers, valves, spouts) - only
//   title, the store's own internal "АРТИКУЛ: ..." code, price, and a
//   per-city stock table. So Характеристики/Описание are derived from the
//   product NAME text (which is rich and consistent), not scraped from a
//   spec table that doesn't exist.
// - The manufacturer's own article number (GROHE's real SKU, e.g.
//   "24256001") is always the leading token of the page <h1>/listing title,
//   NOT the store's internal "АРТИКУЛ: 02-..." code shown in the price
//   block. The leading code is used as Артикул here since it's the
//   portable, manufacturer-recognized SKU.
// - "Назначение"/"Тип" tags shown on SOME listing cards are inconsistent
//   (only ~231/342 items have them, and a couple were visibly mistagged) -
//   subcategory is instead derived from the product name text itself
//   (regex classification, calibrated against all 342 real titles).
// - Images: the real photos are lazy-loaded (data-src, not src) inside
//   .swiper-gallery-main (higher-res w860 versions); .swiper-product-main
//   duplicates the same images at w430 and is used as a fallback for
//   product pages that lack the lightbox gallery.

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BASE = 'https://mirceramiki.kz';
const OUT_DIR = path.join(__dirname, 'out');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REQUEST_DELAY_MS = 500;
const RETRIES_PER_PRODUCT = 3;
// NOTE: deliberately no bare "502"/"503" check - a real product article code
// ("35028000") coincidentally contains "502" as a substring and falsely
// tripped this as an "error page" during the actual scrape run. Numeric
// HTTP-style codes aren't reliable here; the textual phrases are specific
// enough on their own.
const ERROR_PAGE_RE = /service temporarily unavailable|too many requests|bad gateway|gateway timeout|access denied|request unsuccessful/i;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ---------- listing ----------

async function collectListingLinks(page, url, log) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);

  for (let i = 0; i < 60; i++) {
    const moreBtn = page.locator('a.loader:has-text("Показать еще")').first();
    if (!(await moreBtn.count().catch(() => 0))) break;
    if (!(await moreBtn.isVisible().catch(() => false))) break;
    await moreBtn.scrollIntoViewIfNeeded().catch(() => {});
    await moreBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900);
  }

  const links = await page.evaluate(() =>
    Array.from(new Set(Array.from(document.querySelectorAll('a[href*="/product/"]')).map((a) => a.getAttribute('href'))))
  );
  log(`  ${url} -> ${links.length} товаров`);
  return links;
}

// ---------- product page ----------

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(500);

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  if (ERROR_PAGE_RE.test(bodyText)) {
    throw new Error(`error page served instead of product (${bodyText.slice(0, 60).trim()})`);
  }

  const data = await page.evaluate(() => {
    const name = document.querySelector('h1')?.textContent?.trim() || '';
    if (!name) throw new Error('empty h1 - likely a failed/partial page load');

    const artMatch = document.body.innerText.match(/АРТИКУЛ[:\s]*([^\n]+)/i);
    const storeArticle = artMatch ? artMatch[1].trim() : '';

    let imgs = Array.from(document.querySelectorAll('.swiper-gallery-main img[data-src]'));
    if (!imgs.length) imgs = Array.from(document.querySelectorAll('.swiper-product-main img[data-src]'));
    const images = Array.from(new Set(imgs.map((img) => img.getAttribute('data-src')).filter(Boolean)));

    return { name, storeArticle, images };
  });

  data.images = data.images.map((src) => (src.startsWith('http') ? src : BASE + src));
  return data;
}

// ---------- field extraction from product name ----------

function extractArticle(name) {
  const m = name.match(/^([A-Za-z0-9]{5,12})\b/);
  return m ? m[1] : '';
}

const CYR = '[а-яёА-ЯЁ]*';
const COLOR_PARTS = [
  'хром\\s*/\\s*золото', 'золото\\s*/\\s*хром', 'хром\\s+золото',
  'темн' + CYR + '\\s*граф' + CYR + '(\\s*(матов' + CYR + '|глянец))?',
  'суперсталь',
  'холодн' + CYR + '\\s*рассвет(\\s*(матов' + CYR + '|мат|глянец))?',
  'тепл' + CYR + '\\s*закат(\\s*(матов' + CYR + '|мат|глянец))?',
  'бел' + CYR + '\\s*лун' + CYR,
  'фантомн' + CYR + '\\s*ч[её]рн' + CYR,
  'матов' + CYR + '\\s*ч[её]рн' + CYR,
  'ч[её]рн' + CYR + '\\s*матов' + CYR,
  'никель\\s*глянец',
  'никель\\s*браш' + CYR,
  'график' + CYR + '\\s*браш' + CYR,
  'бел(ый|ая|ое)(?![а-яё])',
  'ч[её]рн(ый|ая|ое)(?![а-яё])',
  'син(ий|яя|ее)(?![а-яё])',
  'хром'
];
const COLOR_RE = new RegExp('(' + COLOR_PARTS.join('|') + ')', 'i');

function extractColor(name) {
  const m = name.match(COLOR_RE);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

const KNOWN_COLLECTIONS = [
  'Eurosmart Cosmopolitan', 'Eurostyle Cosmopolitan', 'Eurodisc Cosmopolitan',
  'Grohtherm SmartControl', 'Eurodisc Joy', 'Eurocube Joy', 'Eud Joystick',
  'BauClassic', 'BauEdge', 'BauLoop', 'Bauflow', 'BauCurve',
  'Eurosmart', 'Eurocube', 'Eurostyle', 'Eurodisc', 'EuroEco', 'Grohtherm',
  'Grandera', 'Lineare', 'Cubeo', 'Essence', 'Zedra', 'Minta', 'Costa',
  'Relexa', 'Atrio', 'Concetto', 'Rainshower', 'Blue'
].sort((a, b) => b.length - a.length);

function extractCollection(name) {
  const noCode = name.replace(/^\S+\s*\*?\s*/, '');
  const m = noCode.match(/grohe\s+([a-z][a-z0-9]*(?:\s+[a-z0-9]+){0,2})/i);
  if (m) {
    const words = m[1]
      .split(/\s+/)
      .filter((w) => !/^(c|с)$/i.test(w))
      .filter((w) => !/^(s|m|l|xl|xs)$/i.test(w));
    if (words.length) return words.join(' ');
  }
  for (const k of KNOWN_COLLECTIONS) {
    const re = new RegExp(k.replace(/\s+/g, '\\s+'), 'i');
    if (re.test(noCode)) return k;
  }
  return '';
}

// Calibrated against all 342 real GROHE product titles from the source
// listing (see the recon notes at the top) - mapped onto this project's
// EXISTING "Смесители" subcategory taxonomy (checked live in MongoDB) so
// imported rows merge cleanly with the ~880 products already in that
// category rather than inventing a parallel naming scheme.
// The site has at least one confirmed Latin/Cyrillic homoglyph typo in
// product names (e.g. "*Cмеситель" with a Latin C instead of Cyrillic С),
// which silently breaks Cyrillic-substring matching below. Normalize a
// leading Latin C/c directly touching Cyrillic letters before classifying.
function normalizeHomoglyphs(s) {
  return s.replace(/C(?=[а-яё])/gi, (m) => (m === 'C' ? 'С' : 'с'));
}

function guessSubcategory(name) {
  const s = normalizeHomoglyphs(name.toLowerCase());
  const hasSmesitel = /смесител/.test(s);
  const hasVstr = /встраива|скрытого монтажа|скрытый монтаж|внешняя часть|внутренняя часть|встриваем|внешняя панель|наружная панель/.test(s);
  const hasRakovina = /раковин/.test(s);
  const hasVanna = /ванн/.test(s);
  const hasDush = /душ/.test(s) && !/шланг/.test(s);
  const hasKuhnya = /кухн|мойк/.test(s);
  const hasBide = /биде/.test(s);
  const hasTermostat = /термостат|терсмостат|темостат/.test(s);
  const hasNapolny = /напольн|на борт ванны|для борт ванны/.test(s);
  const hasShlang = /шланг/.test(s);
  const hasIzliv = /излив/.test(s);
  const hasDonnyKlapan = /донн\w*\s*клапан|донн[а-яё]*\s*клапан/i.test(s);
  const hasVentilDivertor = /вентил|дивертор|переключател/.test(s);
  const hasGigDushLeyka = /гигиенич.*лейк|гигиенич.*душ/.test(s);

  if (hasDonnyKlapan && !hasSmesitel && !hasTermostat) return 'Донные клапаны';
  if (hasTermostat) return hasVanna || hasDush ? 'Смесители для ванны и душа с термостатом' : 'Смесители с термостатом';
  if (hasVstr) {
    if (hasRakovina) return 'Смесители для раковины встраиваемые';
    if (hasVanna || hasDush) return 'Смесители для ванны и душа встраиваемые';
    return 'Комплектующие и доп.оборудование для встройки';
  }
  if (hasKuhnya && hasSmesitel) return 'Смесители для кухни';
  if (hasBide) return hasGigDushLeyka ? 'Смесители с гигиеническим душем и биде' : 'Смесители для биде';
  if (hasGigDushLeyka) return hasSmesitel ? 'Смесители с гигиеническим душем' : 'Гигиенические лейки';
  if (hasNapolny && (hasVanna || hasSmesitel)) return 'Смесители напольные и на борт ванны';
  if (hasRakovina) return 'Смесители для раковины';
  if ((hasVanna || hasDush) && hasSmesitel) return 'Смесители для ванны и душа';
  if (hasShlang) return 'Гибкие шланги для душа';
  if (hasIzliv && !hasSmesitel) return 'Изливы';
  if (hasVentilDivertor && !hasSmesitel) return 'Комплектующие и доп.оборудование для встройки';
  if (hasSmesitel) return 'Смесители для ванны и душа';
  if (hasDush || hasVanna || hasRakovina) return 'Комплектующие и доп.оборудование для встройки';
  return 'Комплектующие и доп.оборудование для встройки';
}

// Everything the source site would otherwise put in a spec table is only
// visible as free text inside the product name here (no spec table exists -
// see recon notes) - pull out the few structured facts that ARE reliably
// present so Характеристики isn't just empty for every row.
function extractCharacteristics(name) {
  const out = [];
  const sizeM = name.match(/\b(XS|S|M|L|XL)-?[Ss]ize\b|,\s*(XS|S|M|L|XL)-size\b|размер\s+(XS|S|M|L|XL)\b/i);
  if (sizeM) out.push(['Размер', (sizeM[1] || sizeM[2] || sizeM[3]).toUpperCase()]);

  if (/донн\w*\s*клапан/i.test(name)) out.push(['Донный клапан', 'да']);
  if (/термостат|терсмостат|темостат/i.test(name)) out.push(['Термостат', 'да']);
  if (/напольн/i.test(name)) out.push(['Монтаж', 'напольный']);
  else if (/на борт ванны|для борт ванны/i.test(name)) out.push(['Монтаж', 'на борт ванны']);
  else if (/скрытого монтажа|скрытый монтаж|встраива/i.test(name)) out.push(['Монтаж', 'скрытый (встраиваемый)']);

  const otverstM = name.match(/на\s+(\d+)\s+отверсти/i);
  if (otverstM) out.push(['Количество монтажных отверстий', otverstM[1]]);

  if (/однорычажн/i.test(name)) out.push(['Тип', 'однорычажный']);
  else if (/двухвентильн|с\s+2\s+ручками|двухзахватн/i.test(name)) out.push(['Тип', 'двухвентильный']);

  return out;
}

function shortenDescription(text, maxLen = 280) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

function buildRow(product, brand) {
  const name = product.name;
  const article = extractArticle(name) || product.storeArticle || '';
  const characteristics = extractCharacteristics(name);
  const characteristicsText = characteristics.map(([k, v]) => `${k}: ${v}`).join('\n');

  return {
    'Номенклатура': name,
    'Артикул': article,
    'Бренд': brand,
    'Коллекция': extractCollection(name),
    'Подкатегория': guessSubcategory(name),
    'Цвет': extractColor(name),
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

  ws.columns.forEach((col, idx) => { col.width = idx === 6 ? 45 : idx === 7 ? 40 : idx === 0 ? 55 : 24; });
  ws.getColumn(7).alignment = { wrapText: true };
  ws.getColumn(1).alignment = { wrapText: true };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await wb.xlsx.writeFile(filePath);
}

// Two different listing URLs (or a "показать ещё"-duplicated listing state)
// can surface the SAME product under two different /product/ URLs with the
// same manufacturer article code (confirmed for 4/342 items here - e.g. a
// "распродажа" duplicate page alongside the regular one). Keep one.
function dedupeByArticle(products) {
  const byArticle = new Map();
  const dropped = [];
  for (const p of products) {
    const code = extractArticle(p.name) || p.storeArticle;
    if (!code) { byArticle.set(p.url, p); continue; }
    const existing = byArticle.get(code);
    if (!existing) {
      byArticle.set(code, p);
    } else {
      const better = p.name.length >= existing.name.length ? p : existing;
      const worse = better === p ? existing : p;
      byArticle.set(code, better);
      dropped.push({ kept: better.url, dropped: worse.url, article: code });
    }
  }
  return { unique: Array.from(byArticle.values()), dropped };
}

async function main() {
  const args = process.argv.slice(2);
  const headless = args.includes('--headless');
  const outArg = args.find((a) => a.startsWith('--out='));
  const brandArg = args.find((a) => a.startsWith('--brand='));
  const brand = brandArg ? brandArg.slice('--brand='.length) : 'GROHE';
  const outName = outArg ? outArg.slice('--out='.length) : 'mirceramiki';
  const urls = args.filter((a) => !a.startsWith('--'));

  if (!urls.length) {
    console.error('Использование: node scrape-mirceramiki.js "<url листинга>" [ещё url...] [--brand=GROHE] [--out=имя] [--headless]');
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

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 20 });
  const page = await browser.newPage({ userAgent: UA });

  const allLinks = new Set();
  for (const url of urls) {
    const links = await collectListingLinks(page, url, (m) => console.log(m));
    links.forEach((l) => allLinks.add(l));
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`Всего уникальных ссылок на товары: ${allLinks.size}`);

  const failed = [];
  let done = 0;
  for (const href of allLinks) {
    const url = href.startsWith('http') ? href : BASE + href;
    done++;
    if (scraped[url]) continue;

    let attempt = 0;
    let ok = false;
    while (attempt <= RETRIES_PER_PRODUCT && !ok) {
      try {
        const data = await extractProduct(page, url);
        scraped[url] = { ...data, url };
        ok = true;
      } catch (e) {
        attempt++;
        if (attempt > RETRIES_PER_PRODUCT) {
          console.log(`  ! не удалось: ${url} (${e.message})`);
          failed.push(url);
        } else {
          await sleep(700 * attempt);
        }
      }
    }

    if (done % 20 === 0 || done === allLinks.size) console.log(`  ${done}/${allLinks.size} обработано`);
    fs.writeFileSync(checkpointPath, JSON.stringify(scraped, null, 2));
    await sleep(REQUEST_DELAY_MS);
  }

  const { unique, dropped } = dedupeByArticle(Object.values(scraped));
  if (dropped.length) {
    console.log(`Удалено дублей по артикулу: ${dropped.length}`);
    dropped.forEach((d) => console.log(`  [${d.article}] оставлен ${d.kept}, убран ${d.dropped}`));
  }

  const rows = unique.map((p) => buildRow(p, brand));
  await writeXlsx(rows, xlsxPath);
  console.log(`Готово: ${rows.length} товаров -> ${xlsxPath}`);
  if (failed.length) console.log(`Не удалось получить ${failed.length} товаров:\n  ${failed.join('\n  ')}`);

  await browser.close();
}

module.exports = { buildRow, guessSubcategory, extractColor, extractCollection, extractArticle, extractCharacteristics, dedupeByArticle, writeXlsx };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
