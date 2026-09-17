require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/Product');

// Бренды берутся из аргументов: node scripts/delete-brands.js "Alcaplast" "Hansgrohe"
// Имена должны точно совпадать с полем brand — сверься с scripts/list-brands.js.
const BRANDS = process.argv.slice(2);

(async () => {
  if (!BRANDS.length) {
    console.error('Укажи бренды аргументами, например: node scripts/delete-brands.js "Alcaplast" "Hansgrohe"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const filter = { brand: { $in: BRANDS } };

  const doomed = await Product.find(filter).lean();
  console.log(`Найдено к удалению: ${doomed.length}`);

  const byBrand = {};
  for (const p of doomed) byBrand[p.brand] = (byBrand[p.brand] || 0) + 1;
  for (const b of BRANDS) console.log(`  ${String(byBrand[b] || 0).padStart(5)}  ${b}`);

  const missing = BRANDS.filter((b) => !byBrand[b]);
  if (missing.length) console.log(`ВНИМАНИЕ: ничего не найдено по: ${missing.join(', ')}`);
  if (!doomed.length) {
    await mongoose.disconnect();
    return;
  }

  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  // До минут, иначе второй запуск в тот же день затрёт предыдущий бэкап.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const backupPath = path.join(backupDir, `products-brands-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(doomed, null, 2), 'utf8');
  console.log(`Бэкап сохранён: ${backupPath}`);

  const result = await Product.deleteMany(filter);
  console.log(`Удалено: ${result.deletedCount}`);
  console.log(`Осталось по этим брендам: ${await Product.countDocuments(filter)}`);
  console.log(`Всего товаров в базе теперь: ${await Product.countDocuments({})}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
