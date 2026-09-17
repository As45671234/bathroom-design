require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const CategoryMeta = require('../src/models/CategoryMeta');

// Категория к удалению: и товары, и её CategoryMeta (SEO/картинка).
const CATEGORY_ID = 'полотенцесушители';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const filter = { category_id: CATEGORY_ID };

  const doomed = await Product.find(filter).lean();
  const meta = await CategoryMeta.find({ category_id: CATEGORY_ID }).lean();
  console.log(`Найдено товаров к удалению: ${doomed.length}`);
  console.log(`Найдено CategoryMeta: ${meta.length}`);

  const titles = {};
  for (const p of doomed) titles[p.category_title] = (titles[p.category_title] || 0) + 1;
  for (const t of Object.keys(titles)) console.log(`  ${String(titles[t]).padStart(5)}  ${JSON.stringify(t)}`);

  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(backupDir, `category-${CATEGORY_ID}-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ products: doomed, meta }, null, 2), 'utf8');
  console.log(`Бэкап сохранён: ${backupPath}`);

  const result = await Product.deleteMany(filter);
  const metaResult = await CategoryMeta.deleteMany({ category_id: CATEGORY_ID });
  console.log(`Удалено товаров: ${result.deletedCount}`);
  console.log(`Удалено CategoryMeta: ${metaResult.deletedCount}`);
  console.log(`Осталось по этой категории: ${await Product.countDocuments(filter)}`);
  console.log(`Всего товаров в базе теперь: ${await Product.countDocuments({})}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
