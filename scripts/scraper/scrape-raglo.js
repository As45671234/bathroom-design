// Scrapes raglo.kz into one .xlsx PER CATEGORY (not one merged file) - each
// category is its own product type (Смесители для ванны / раковины / гиг.
// душа и биде / Полотенцесушители) and gets its own category assigned on
// import, so mixing them into a single sheet would tag everything with
// whatever category the admin picks once at upload time. Column layout
// matches the other scrapers (Номенклатура, Артикул, Бренд, Коллекция,
// Подкатегория, Цвет, Характеристики, Описание, Картинка 1..N).
//
// Only products whose article ("Артикул") contains R03, R10 or R20 are kept -
// these are Raglo's own design-line codes (e.g. R03.30.05, R20.11.05), shared
// across multiple fixture categories. The code is also written into the
// "Коллекция" column since it plays the same role a named collection would on
// other brands' sites. Use --no-filter-categories for a category that should
// be taken in full instead (e.g. polotentsesushiteli only ever uses the R350
// line, so the filter would otherwise keep nothing there).
//
// raglo.kz has no "Описание" text anywhere on a product page (only a
// Характеристики tab and Отзывы), so that column is always left blank - this
// is a real gap in the site's own data, not a scraper bug. Breadcrumbs are
// also only one level deep (just the category itself), so "Подкатегория" is
// left blank too.
//
// Usage:
//   node scrape-raglo.js [--categories=slug1,slug2,...] [--no-filter-categories=slug1,...] [--out=prefix] [--headless]
//
// Output: out/<prefix>-<category-slug>.xlsx, one file per category.
//
// Default categories (the 4 the user asked about):
//   smesitel-dlya-vanny, smesitel-dlya-rakoviny, gigienicheskij-dush, polotentsesushiteli
//
// Examples:
//   node scrape-raglo.js --out=raglo --headless
//   node scrape-raglo.js --categories=polotentsesushiteli --no-filter-categories=polotentsesushiteli --out=raglo --headless

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BASE = 'https://raglo.kz';
const OUT_DIR = path.join(__dirname, 'out');

const DEFAULT_CATEGORIES = [
  'smesitel-dlya-vanny',
  'smesitel-dlya-rakoviny',
  'gigienicheskij-dush',
  'polotentsesushiteli'
];

// The user's requested design-line codes ("вид товара"). Matched as a plain
// substring of the article, e.g. "R20.11.05" and the compound "R20272.09..."
// variant both contain "R20"; "R21.10", "R51.30", "R01.10" etc do not.
const CODE_RE = /R(03|10|20)/i;

const REQUEST_DELAY_MS = 250;
const RETRIES_PER_PRODUCT = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchedCode(sku) {
  const m = CODE_RE.exec(sku);
  return m ? `R${m[1]}` : '';
}

async function collectListing(page, categorySlug, requireMatch, log) {
  const url = `${BASE}/catalog/${categorySlug}/page-all`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  const items = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.fn_product')).map((el) => {
      const sku = el.querySelector('.fn_sku')?.textContent?.trim() || '';
      const href = el.querySelector('a[href^="/products/"]')?.getAttribute('href') || '';
      return { sku, href };
    });
  });

  const matched = items
    .filter((it) => it.href && (!requireMatch || CODE_RE.test(it.sku)))
    .map((it) => ({ ...it, category: categorySlug }));
  log(`  ${categorySlug}: ${items.length} товаров всего, ${matched.length} ${requireMatch ? 'подходят по артикулу' : 'берём все'}`);
  return matched;
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  const data = await page.evaluate(() => {
    const name = document.querySelector('h1')?.textContent?.trim() || '';
    const article = document.querySelector('.fn_sku')?.textContent?.trim() || '';
    const brand = /splenka/i.test(name) ? 'Splenka' : 'Raglo';

    const characteristics = Array.from(document.querySelectorAll('.features__item'))
      .map((li) => {
        const key = li.querySelector('.features__name')?.textContent?.replace(/:\s*$/, '').trim() || '';
        const value = li.querySelector('.features__value')?.textContent?.trim() || '';
        return [key, value];
      })
      .filter(([k, v]) => k && v);

    const images = Array.from(document.querySelectorAll('a[data-fancybox]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean);

    return { name, article, brand, characteristics, images: Array.from(new Set(images)) };
  });

  data.images = data.images.map((src) => (src.startsWith('http') ? src : BASE + src));
  return data;
}

function buildRow(product) {
  const pairs = product.characteristics;
  const find = (re) => {
    const hit = pairs.find(([k]) => re.test(k));
    return hit ? hit[1].trim() : '';
  };
  const color = find(/цвет/i);
  const characteristicsText = pairs.map(([k, v]) => `${k}: ${v}`).join('\n');

  return {
    'Номенклатура': product.name,
    'Артикул': product.article,
    'Бренд': product.brand,
    'Коллекция': matchedCode(product.article),
    'Подкатегория': '',
    'Цвет': color,
    'Характеристики': characteristicsText,
    'Описание': '',
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
  const outName = outArg ? outArg.slice('--out='.length) : 'raglo';
  const catArg = args.find((a) => a.startsWith('--categories='));
  const categories = catArg ? catArg.slice('--categories='.length).split(',').filter(Boolean) : DEFAULT_CATEGORIES;
  const noFilterArg = args.find((a) => a.startsWith('--no-filter-categories='));
  const noFilterCategories = new Set(noFilterArg ? noFilterArg.slice('--no-filter-categories='.length).split(',').filter(Boolean) : []);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // One shared checkpoint (keyed by product URL) across all categories so
  // re-running is cheap, but output is still split per category below.
  const checkpointPath = path.join(OUT_DIR, `${outName}.json`);

  let scraped = {};
  if (fs.existsSync(checkpointPath)) {
    scraped = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    console.log(`Резюме: уже есть ${Object.keys(scraped).length} товаров в чекпоинте ${outName}.json`);
  }

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 30 });
  const page = await browser.newPage();

  const toScrape = new Map();
  for (const category of categories) {
    const requireMatch = !noFilterCategories.has(category);
    const matched = await collectListing(page, category, requireMatch, (m) => console.log(m));
    matched.forEach((it) => toScrape.set(it.href, it));
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`Всего подходящих товаров: ${toScrape.size}`);

  const failed = [];
  let done = 0;
  for (const [href, { category }] of toScrape) {
    const url = href.startsWith('http') ? href : BASE + href;
    done++;
    if (scraped[url]) {
      scraped[url].category = category;
      continue;
    }

    let attempt = 0;
    let ok = false;
    while (attempt <= RETRIES_PER_PRODUCT && !ok) {
      try {
        const data = await extractProduct(page, url);
        scraped[url] = { ...data, url, category };
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

    console.log(`  ${done}/${toScrape.size} обработано`);
    fs.writeFileSync(checkpointPath, JSON.stringify(scraped, null, 2));
    await sleep(REQUEST_DELAY_MS);
  }

  const byCategory = new Map();
  for (const product of Object.values(scraped)) {
    if (!toScrape.has(product.url.replace(BASE, ''))) continue; // not part of this run's requested categories
    const list = byCategory.get(product.category) || [];
    list.push(product);
    byCategory.set(product.category, list);
  }

  for (const [category, products] of byCategory) {
    const rows = products.map((p) => buildRow(p));
    const xlsxPath = path.join(OUT_DIR, `${outName}-${category}.xlsx`);
    await writeXlsx(rows, xlsxPath);
    console.log(`Готово: ${rows.length} товаров -> ${xlsxPath}`);
  }
  if (failed.length) console.log(`Не удалось получить ${failed.length} товаров`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
