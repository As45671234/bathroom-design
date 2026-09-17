require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const byBrandField = await Product.countDocuments({ brand: { $regex: /^allen\s*brau$/i } });
  const byNameMatch = await Product.countDocuments({ name: { $regex: /allen\s*brau/i } });
  const byEitherMatch = await Product.countDocuments({
    $or: [{ brand: { $regex: /^allen\s*brau$/i } }, { name: { $regex: /allen\s*brau/i } }]
  });

  console.log('По полю brand === "Allen Brau":', byBrandField);
  console.log('По названию содержит "Allen Brau":', byNameMatch);
  console.log('По любому из двух признаков:', byEitherMatch);

  const total = await Product.countDocuments({});
  console.log('Всего товаров в базе:', total);

  const byCategory = await Product.aggregate([
    { $match: { $or: [{ brand: { $regex: /^allen\s*brau$/i } }, { name: { $regex: /allen\s*brau/i } }] } },
    { $group: { _id: { category_id: '$category_id', category_title: '$category_title' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  console.log('\nПо категориям:');
  byCategory.forEach((c) => console.log(`  ${c._id.category_title} (${c._id.category_id}): ${c.count}`));

  const sample = await Product.find({
    $or: [{ brand: { $regex: /^allen\s*brau$/i } }, { name: { $regex: /allen\s*brau/i } }]
  }).limit(5).select('name brand category_title');
  console.log('\nПример записей:');
  sample.forEach((p) => console.log(`  - [${p.brand || '(пусто)'}] ${p.name} — ${p.category_title}`));

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
