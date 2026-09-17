require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const filter = {
    $or: [{ brand: { $regex: /^allen\s*brau$/i } }, { name: { $regex: /allen\s*brau/i } }]
  };

  const before = await Product.countDocuments(filter);
  const result = await Product.deleteMany(filter);
  const after = await Product.countDocuments(filter);

  console.log(`Найдено перед удалением: ${before}`);
  console.log(`Удалено: ${result.deletedCount}`);
  console.log(`Осталось после удаления: ${after}`);

  const total = await Product.countDocuments({});
  console.log(`Всего товаров в базе теперь: ${total}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
