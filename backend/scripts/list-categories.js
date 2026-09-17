require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const rows = await Product.aggregate([
    { $group: { _id: { id: '$category_id', title: '$category_title' }, count: { $sum: 1 } } },
    { $sort: { '_id.title': 1 } }
  ]);

  for (const r of rows) {
    console.log(`${String(r.count).padStart(5)}  ${JSON.stringify(r._id.title)}  (id: ${r._id.id})`);
  }
  console.log('---');
  console.log('Всего товаров:', await Product.countDocuments({}));

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
