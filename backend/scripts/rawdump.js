const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
const buffer = fs.readFileSync(filePath);
const wb = XLSX.read(buffer, { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', cellText: false });

console.log('Sheet:', wb.SheetNames[0], 'rows:', rows.length);
console.log('\n--- HEADER ROW (row 1) ---');
rows[0].forEach((c, i) => console.log(`  [${i}] ${JSON.stringify(String(c).slice(0, 60))}`));

console.log('\n--- ROW 2 (first data row) ---');
rows[1].forEach((c, i) => console.log(`  [${i}] ${JSON.stringify(String(c).slice(0, 80))}`));

// find a row whose column 0 (Номенклатура) starts with "Коллекция:" - the broken pattern
const brokenIdx = rows.findIndex((r, i) => i > 0 && String(r[0] || '').startsWith('Коллекция:'));
console.log(`\n--- First broken row index: ${brokenIdx} ---`);
if (brokenIdx > 0) {
  rows[brokenIdx].forEach((c, i) => console.log(`  [${i}] ${JSON.stringify(String(c).slice(0, 80))}`));
  console.log('\n--- Row just before it (index ' + (brokenIdx - 1) + ') ---');
  rows[brokenIdx - 1].forEach((c, i) => console.log(`  [${i}] ${JSON.stringify(String(c).slice(0, 80))}`));
}

// Replicate looksLikeHeaderRow() to see which rows (besides row 0) get
// misdetected as a NEW header row, which would silently rebuild headerMap
// mid-file and corrupt every row after it until the next false-positive.
function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function looksLikeHeaderRow(row) {
  const joined = row.map((c) => normalizeHeader(c)).join(' | ');
  const hasName = joined.includes('наименование') || joined.includes('название') || joined.includes('номенклатура');
  const hasSku = joined.includes('артикул');
  const hasPrice = joined.includes('цена');
  const hasMeas = joined.includes('ед изм');
  const hasQty = joined.includes('количеств');
  const score = [hasName, hasSku, hasPrice, hasMeas, hasQty].filter(Boolean).length;
  return { isHeader: score >= 2, hasName, hasSku, hasPrice, hasMeas, hasQty };
}

console.log('\n--- Rows misdetected as header (besides row 0) ---');
let falsePositives = 0;
rows.forEach((r, i) => {
  if (i === 0) return;
  const res = looksLikeHeaderRow(r);
  if (res.isHeader) {
    falsePositives++;
    if (falsePositives <= 5) {
      console.log(`  row ${i}: ${JSON.stringify(res)}`);
      console.log(`    col0=${JSON.stringify(String(r[0] || '').slice(0, 80))}`);
    }
  }
});
console.log(`Total false-positive header rows: ${falsePositives}`);
