const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    productId: { type: String, default: "" },
    name: { type: String, required: true },
    sku: { type: String, default: "" },
    unit: { type: String, default: "шт" },
    image: { type: String, default: "" },
    price: { type: Number },
    quantity: { type: Number, required: true },
    lineTotal: { type: Number }
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    // Phone is the only required contact: this is a KZ retail shop where most
    // customers order from a phone and an email field was pure checkout friction.
    customerName: { type: String, default: "" },
    customerPhone: { type: String, required: true },
    customerEmail: { type: String, default: "" },
    address: { type: String, default: "" },
    comment: { type: String, default: "" },
    deliveryMethod: { type: String, enum: ["courier", "pickup", "transport_company"], default: "courier" },
    paymentMethod: { type: String, enum: ["kaspi", "halyk", "cash"], default: "kaspi" },

    status: { type: String, enum: ["new", "processing", "completed", "cancelled"], default: "new", index: true },

    items: { type: [OrderItemSchema], default: [] },

    total: { type: Number, default: 0 }
  },
  { timestamps: true }
);

OrderSchema.index({ createdAt: -1 });

OrderSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("Order", OrderSchema);
