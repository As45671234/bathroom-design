const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..', '..', 'backend');
const { workbookToProducts } = require(path.join(backendDir, 'src', 'services', 'excelImport.js'));

(async () => {
  const filePath = process.argv[2] || path.join(__dirname, 'out', 'smesiteli.xlsx');
  const buffer = fs.readFileSync(filePath);
  const items = await workbookToProducts({
    buffer,
    filename: path.basename(filePath),
    imagesDir: path.join(__dirname, 'out', '_validate_images'),
    target: { id: 'smesiteli', title: 'Смесители' }
  });

  console.log(`Разобрано товаров: ${items.length}`);

  const keyCount = new Map();
  for (const it of items) {
    keyCount.set(it.key, (keyCount.get(it.key) || 0) + 1);
  }
  const dupes = Array.from(keyCount.entries()).filter(([, c]) => c > 1);
  console.log(`Дублирующихся ключей: ${dupes.length}`);
  dupes.slice(0, 5).forEach(([key, count]) => {
    console.log(`\n--- KEY (${count}x): ${key}`);
    items.filter((it) => it.key === key).forEach((it) => {
      console.log(`  name=${JSON.stringify(it.name).slice(0, 200)}`);
      console.log(`  sku=${JSON.stringify(it.sku)}`);
    });
  });

  const noSku = items.filter((it) => !it.sku);
  console.log(`\nТоваров без sku: ${noSku.length}`);
  noSku.slice(0, 3).forEach((it) => {
    console.log(`  name=${JSON.stringify(it.name).slice(0, 200)}`);
  });
})().catch((e) => { console.error(e); process.exit(1); });
