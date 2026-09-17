// Regenerates a sanstore .xlsx from an already-scraped checkpoint JSON,
// applying the current buildRow/article-fallback logic - no re-fetching.
const fs = require('fs');
const path = require('path');
const { buildRow, writeXlsx, extractArticleFromName, cleanArticle } = require('./scrape-sanstore.js');

async function main() {
  const outName = process.argv[2];
  if (!outName) {
    console.error('Использование: node regen-sanstore-xlsx.js <outName>');
    process.exit(1);
  }
  const OUT_DIR = path.join(__dirname, 'out');
  const checkpointPath = path.join(OUT_DIR, `${outName}.json`);
  const xlsxPath = path.join(OUT_DIR, `${outName}.xlsx`);

  const scraped = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  let fixedCount = 0;
  for (const entry of Object.values(scraped)) {
    const cleaned = cleanArticle(entry.article);
    if (!cleaned) {
      entry.article = extractArticleFromName(entry.name);
      if (entry.article) fixedCount++;
    } else if (cleaned !== entry.article) {
      entry.article = cleaned;
    }
  }
  console.log(`Артикулов восстановлено из названия: ${fixedCount}`);

  // Exact duplicates first: the same product listed under two different
  // URLs on the site (identical name AND article) - drop the extra copy
  // rather than importing the same product twice.
  const seenExact = new Set();
  let exactDupsDropped = 0;
  for (const [url, entry] of Object.entries(scraped)) {
    if (!entry.article) continue;
    const exactKey = `${entry.name.trim().toLowerCase()}|${entry.article.toLowerCase()}`;
    if (seenExact.has(exactKey)) { delete scraped[url]; exactDupsDropped++; }
    else seenExact.add(exactKey);
  }
  console.log(`Точных дублей (тот же товар по двум ссылкам) удалено: ${exactDupsDropped}`);

  // The article is the sole key for the real import (category+sku, name is
  // NOT part of it) - two genuinely different products that ended up with
  // the same scraped article would silently collide into one DB row (or
  // fail to insert on the unique index). Resolve any collision by keeping
  // the article only on whichever row it actually appears in verbatim; for
  // the rest, try a name-derived article first, and if that still collides
  // (e.g. the site itself shows one base code for several color variants),
  // fall back to a numeric suffix so every row stays importable.
  const byArticle = new Map();
  for (const entry of Object.values(scraped)) {
    if (!entry.article) continue;
    const list = byArticle.get(entry.article) || [];
    list.push(entry);
    byArticle.set(entry.article, list);
  }
  let resolvedCollisions = 0;
  const allArticles = new Set(Object.values(scraped).map((e) => e.article).filter(Boolean));
  for (const [article, list] of byArticle) {
    if (list.length < 2) continue;
    const selfConsistent = list.filter((e) => e.name.toUpperCase().includes(article.toUpperCase()));
    const keeper = selfConsistent[0] || list[0];
    let suffix = 2;
    for (const entry of list) {
      if (entry === keeper) continue;
      let candidate = extractArticleFromName(entry.name);
      if (!candidate || candidate === article || allArticles.has(candidate)) {
        candidate = `${article}-${suffix++}`;
      }
      entry.article = candidate;
      allArticles.add(candidate);
      resolvedCollisions++;
    }
  }
  console.log(`Разрешено коллизий одинаковых артикулов: ${resolvedCollisions}`);

  const rows = Object.values(scraped).map((p) => buildRow(p));
  await writeXlsx(rows, xlsxPath);
  console.log(`Готово: ${rows.length} товаров -> ${xlsxPath}`);

  const stillMissing = rows.filter((r) => !r['Артикул']).length;
  console.log(`Всё ещё без артикула: ${stillMissing}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
