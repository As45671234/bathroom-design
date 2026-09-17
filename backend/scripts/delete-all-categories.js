require('dotenv').config();
const mongoose = require('mongoose');
const CategoryMeta = require('../src/models/CategoryMeta');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const before = await CategoryMeta.countDocuments({});
  const result = await CategoryMeta.deleteMany({});
  const after = await CategoryMeta.countDocuments({});

  console.log(`Найдено перед удалением: ${before}`);
  console.log(`Удалено: ${result.deletedCount}`);
  console.log(`Осталось после удаления: ${after}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
