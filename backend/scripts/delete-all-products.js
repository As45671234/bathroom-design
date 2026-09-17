require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const before = await Product.countDocuments({});
  const result = await Product.deleteMany({});
  const after = await Product.countDocuments({});

  console.log(`Найдено перед удалением: ${before}`);
  console.log(`Удалено: ${result.deletedCount}`);
  console.log(`Осталось после удаления: ${after}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
