const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema(
  {
    phone: { type: String, default: '+7 700 000 00 00' },
    email: { type: String, default: 'info@bathroomdesign.kz' },
    address: { type: String, default: 'г. Алматы' },
    kaspiEnabled: { type: Boolean, default: true },
    kaspiUrl: { type: String, default: '' },
    halykEnabled: { type: Boolean, default: false },
    halykUrl: { type: String, default: '' },
    // Social profiles — the footer only renders an icon when its URL is filled in,
    // so an unconfigured network simply doesn't appear (no dead "#" links).
    instagramUrl: { type: String, default: '' },
    facebookUrl: { type: String, default: '' },
    heroSlides: [
      {
        title: { type: String, default: '' },
        subtitle: { type: String, default: '' },
        desc: { type: String, default: '' },
        img: { type: String, default: '' },
      },
    ],
    aboutSlides: [
      {
        title: { type: String, default: '' },
        text: { type: String, default: '' },
        imageUrl: { type: String, default: '' },
        bullets: [{ type: String }],
      },
    ],
    homepageImages: {
      headerLogo: { type: String, default: '' },
      footerLogo: { type: String, default: '' },
      partnersBackground: { type: String, default: '' },
      productSlides: [
        {
          id: { type: String, default: '' },
          title: { type: String, default: '' },
          description: { type: String, default: '' },
          image: { type: String, default: '' },
        },
      ],
      partnerLogos: [{ type: String }],
    },
    colorSwatches: [
      {
        code: { type: String, default: '' },
        title: { type: String, default: '' },
        image: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
