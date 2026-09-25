
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Hero from '../components/Hero';
import LeadForm from '../components/LeadForm';
import Reveal from '../components/Reveal';
import CategoryCarousel from '../components/CategoryCarousel';
import ProductCard from '../components/ProductCard';
import { CatalogError } from '../components/CatalogState';
import { CatalogStatus, Category, Product, SiteSettings } from '../types';
import { normalizeAssetUrl } from '../utils/assetUrl';
import { applySeo } from '../utils/seo';
import {
  displayPrice,
  getProductColor,
  getProductImages,
  normalizeValue,
  productFamilyKey,
  productFamilyName,
  productPath,
  specEntries,
} from '../utils/product';
import { finishSwatch } from '../utils/finish';

/**
 * A showcase row for the homepage: takes products round-robin across categories
 * so the strip isn't eight variations of the same faucet. A photo is required,
 * a price is not — the whole catalog is priced on request, so filtering on
 * `prices.retail` would empty this section completely.
 */
const pickShowcase = (categories: Category[], limit: number): Product[] => {
  const buckets = categories.map((c) => (c.items || []).filter((p) => getProductImages(p).length > 0));
  const picked: Product[] = [];
  // The catalog carries the same model in many finishes under one name, so
  // dedupe by name — otherwise the strip shows "Смеситель для раковины" ×5.
  const seenNames = new Set<string>();
  const maxDepth = Math.max(0, ...buckets.map((b) => b.length));

  for (let round = 0; round < maxDepth && picked.length < limit; round += 1) {
    for (const bucket of buckets) {
      if (picked.length >= limit) break;
      const candidate = bucket[round];
      if (!candidate) continue;
      const key = candidate.name.trim().toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      picked.push(candidate);
    }
  }
  return picked;
};

// What makes a good editorial hero, best first. Scored on the product kind
// rather than its category: "смесители" also contains донные клапаны, изливы
// and ручки, which tie with real mixers on finish count but look like spare
// parts. Without this the block is won on raw data richness alone — that would
// currently greet every visitor with a toilet bowl (12 finishes, 23 specs).
const FEATURED_KIND_RANK = [
  /^смеситель\s+для\s+раковины/i,
  /^смеситель/i,
  /^душев(ая|ой)\s+(система|стойка|гарнитур)/i,
  /^(акриловая\s+)?ванна/i,
];

// Raglo ships no clean product photography at all — every image in its library,
// packshot and lifestyle alike, has red marketing badges and Russian sales copy
// baked into the pixels. Fine in a catalog grid, wrong for a full-bleed hero.
// Raglo products stay everywhere else on the site; they just can't anchor this.
const FEATURED_EXCLUDED_BRANDS = ['Raglo'];

// Enough of a spec table to fill the layout. Brands that ship many finishes but
// no attributes at all (Maier, Bugnatese) also ship 139x162px product shots,
// so this doubles as an image-quality filter.
const MIN_FEATURED_SPECS = 8;
const MIN_FEATURED_FINISHES = 3;

// Already shown elsewhere in this block, or warehouse trivia.
const FEATURED_SPEC_NOISE = /^(коллекц|артикул|штрих|код|гарант)|упаковк|вес|объем/i;

/**
 * Specs for the featured block, most informative first.
 *
 * Attribute order in the feed is arbitrary, and taking the first six lands on
 * "Ширина 50 / Глубина 160 / Высота 169" — bare numbers whose key carries no
 * unit, so there is no honest way to render them. Descriptive values
 * ("Латунь", "Рычажное") are kept ahead of those instead of inventing a "мм".
 */
const featuredSpecList = (product: Product) => {
  const hasUnit = (key: string) => /,|\bмм\b|\bсм\b|\bм\b|\bкг\b/i.test(key);
  const entries = specEntries(product).filter(([key]) => !FEATURED_SPEC_NOISE.test(key.trim()));
  const bare = (entry: readonly [string, string]) => (/^[\d.,\s]+$/.test(entry[1]) && !hasUnit(entry[0]) ? 1 : 0);
  return entries.map((entry, idx) => ({ entry, idx })).sort((a, b) => bare(a.entry) - bare(b.entry) || a.idx - b.idx);
};

/**
 * Picks the model for the "Выбор Bathroom Design" block: the same product in
 * several real finishes, with a spec table worth reading.
 *
 * Families are grouped by `productFamilyKey` rather than by name — most of the
 * catalog spells the finish into the product name, so name-grouping split every
 * rich family into singletons and left only the spec-less brands looking like
 * they had variants.
 */
const pickFeaturedFamily = (categories: Category[]) => {
  const families = new Map<string, Product[]>();
  for (const product of categories.flatMap((c) => c.items || [])) {
    if (getProductImages(product).length === 0) continue;
    const key = productFamilyKey(product);
    families.set(key, [...(families.get(key) || []), product]);
  }

  let best: { finishes: { product: Product; color: string }[]; score: number } | null = null;

  for (const variants of families.values()) {
    if (FEATURED_EXCLUDED_BRANDS.includes(variants[0].brand || '')) continue;

    const rank = FEATURED_KIND_RANK.findIndex((kind) => kind.test(variants[0].name.trim()));
    if (rank === -1) continue;

    // De-duplicate finishes that only differ in spelling ("Черный матовый" vs
    // "Черный Матовый") — the same collapsing the catalog filters do.
    const seen = new Set<string>();
    const finishes = variants
      .map((product) => ({ product, color: getProductColor(product) }))
      .filter(({ color }) => {
        if (!color) return false;
        const key = normalizeValue(color);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (finishes.length < MIN_FEATURED_FINISHES) continue;

    const specs = Math.max(...finishes.map(({ product }) => specEntries(product).length));
    if (specs < MIN_FEATURED_SPECS) continue;

    // Kind first, then the family with the most to show within it.
    const score = (FEATURED_KIND_RANK.length - rank) * 1000 + finishes.length * 10 + specs;
    if (!best || score > best.score) best = { finishes, score };
  }
  if (!best) return null;

  // Open on the finish with the fullest spec sheet — siblings sometimes drop
  // attributes, and the selected finish drives the table below it. The swatch
  // order itself stays as the catalog lists it.
  const heroIndex = best.finishes.reduce(
    (bestIdx, { product }, idx, list) =>
      specEntries(product).length > specEntries(list[bestIdx].product).length ? idx : bestIdx,
    0
  );
  return { hero: best.finishes[heroIndex].product, heroIndex, finishes: best.finishes };
};

interface HomePageProps {
  categories: Category[];
  catalogStatus: CatalogStatus;
  onAddToCart: (p: Product) => void;
  siteSettings?: SiteSettings | null;
}

// The 5 categories featured with real photography on the homepage strip — the
// most visually strong ones to shoot/source well. The rest of the catalog is
// still fully browsable via "Каталог" / "Показать все категории". Each one is
// paired with a hand-picked lifestyle shot in /public/categories rather than
// the category's own supplier cutout, which is a plain white-background photo.
const FEATURED_CATEGORIES: { id: string; image: string }[] = [
  { id: 'смесители', image: '/categories/smesiteli.jpg' },
  { id: 'керамика', image: '/categories/keramika.jpg' },
  { id: 'душевые-системы-и-души', image: '/categories/dushevye.webp' },
  { id: 'аксессуары', image: '/categories/aksessuary.jpg' },
  { id: 'ванны', image: '/categories/vanny.webp' },
];

const TRUST_SIGNALS = [
  { icon: 'fa-truck', title: 'Быстрая доставка', desc: 'По Алматы и всему Казахстану' },
  { icon: 'fa-shield-alt', title: 'Гарантия качества', desc: 'Официальная гарантия от брендов' },
  { icon: 'fa-star', title: 'Проверенные бренды', desc: 'Grohe, Roca, Cersanit и другие' },
  { icon: 'fa-headset', title: 'Консультация', desc: 'Поможем подобрать решение под ваш проект' },
];

const HomePage: React.FC<HomePageProps> = ({ categories, catalogStatus, onAddToCart, siteSettings }) => {
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isLeadSuccessOpen, setIsLeadSuccessOpen] = useState(false);

  const contactPhone = siteSettings?.phone || '+7 700 000 00 00';
  const contactEmail = siteSettings?.email || 'info@bathroomdesign.kz';
  const contactAddress = siteSettings?.address || 'г. Алматы';

  const featured = useMemo(() => pickFeaturedFamily(categories), [categories]);
  const showcase = useMemo(() => pickShowcase(categories, 8), [categories]);
  const [activeFinish, setActiveFinish] = useState(0);

  // Homepage highlight strip: 5 curated categories with real, hand-picked
  // lifestyle photography (not raw supplier catalog cutouts) — the rest of the
  // catalog (10 categories total) stays reachable via "Показать все категории".
  const featuredCats = useMemo(
    () =>
      FEATURED_CATEGORIES.flatMap(({ id, image }) => {
        const cat = categories.find((c) => c.id === id);
        return cat ? [{ id: cat.id, title: cat.title, image, count: cat.items?.length || 0 }] : [];
      }),
    [categories]
  );

  // A new catalog load can change which family wins — don't keep pointing at a
  // finish index that no longer exists.
  useEffect(() => setActiveFinish(featured?.heroIndex ?? 0), [featured?.hero.id, featured?.heroIndex]);

  const featuredProduct = featured ? (featured.finishes[activeFinish]?.product || featured.hero) : null;
  const featuredSpecs = featuredProduct ? featuredSpecList(featuredProduct).slice(0, 6).map((x) => x.entry) : [];

  useEffect(() => {
    const totalCategories = categories.length;
    const totalItems = categories.reduce((sum, category) => sum + (category.items?.length || 0), 0);

    return applySeo({
      title: 'Bathroom Design — сантехника, мебель и плитка для ванной комнаты',
      description: `Bathroom Design — каталог сантехники, мебели и плитки для ванных комнат в Казахстане. Категорий: ${totalCategories}, товаров: ${totalItems}.`,
      keywords: 'сантехника, ванная комната, мебель для ванной, плитка, смесители, душевые кабины, кухня, мойки для кухни, дизайн интерьера, дизайн ванной комнаты, хром, черный матовый, никель, золото, графит, белый, бронза, сатин, Казахстан, Алматы, Астана, GROHE, Allen Brau, Villeroy & Boch, Maier, Bugnatese, Raglo, TECE, Viega',
      canonicalUrl: 'https://bathroomdesign.kz/',
      ogType: 'website',
      ogUrl: 'https://bathroomdesign.kz/',
      twitterCard: 'summary_large_image',
    });
  }, [categories]);

  useEffect(() => {
    if (!isLeadModalOpen && !isLeadSuccessOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isLeadSuccessOpen) setIsLeadSuccessOpen(false);
      else setIsLeadModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLeadModalOpen, isLeadSuccessOpen]);

  const leadModal = isLeadModalOpen ? (
    <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-4" onClick={() => setIsLeadModalOpen(false)}>
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl p-8 text-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-heading font-semibold text-[#1D2B49] uppercase tracking-tight">Заказать консультацию</h3>
          <button
            type="button"
            onClick={() => setIsLeadModalOpen(false)}
            className="w-10 h-10 rounded-2xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700"
            aria-label="Закрыть"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <LeadForm onSuccess={() => { setIsLeadModalOpen(false); setIsLeadSuccessOpen(true); }} />
      </div>
    </div>
  ) : null;

  const leadSuccessModal = isLeadSuccessOpen ? (
    <div className="fixed inset-0 z-[9999] bg-black/55 flex items-center justify-center p-4" onClick={() => setIsLeadSuccessOpen(false)}>
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8" onClick={(e) => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center text-2xl mb-5">
          <i className="fas fa-check"></i>
        </div>
        <h3 className="text-2xl font-heading font-semibold text-[#1D2B49] uppercase tracking-tight mb-2">Заявка отправлена</h3>
        <p className="text-gray-500 mb-7">Спасибо! Мы получили вашу заявку и свяжемся с вами в ближайшее время.</p>
        <button
          type="button"
          onClick={() => setIsLeadSuccessOpen(false)}
          className="w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs bg-[#1D2B49] text-white hover:bg-[#152036] transition-all"
        >
          Отлично
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div>
      <Hero slides={siteSettings?.heroSlides} />

      {/* Category highlight strip — 5 curated categories with real, hand-picked
          photography in an auto-scrolling carousel, each a tall card with a
          bottom gradient + bold label. Curated lifestyle photos (not raw
          supplier catalog cutouts) crop cleanly via object-cover; the rest of
          the catalog stays reachable below and via the header's "Каталог". */}
      <section className="bg-white py-20" id="catalog">
        <div className="container mx-auto px-6 mb-12">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Каталог</div>
          <h2 className="font-display italic text-3xl md:text-4xl text-[#1D2B49]">Каталог по категориям</h2>
          <div className="w-16 h-1 bg-[#CEA549] rounded-full mt-3" />
          <p className="text-gray-500 mt-4">Выберите категорию, чтобы посмотреть товары</p>
        </div>

        {catalogStatus === 'loading' ? (
          <div className="flex gap-[10px] overflow-hidden px-6" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="h-[400px] w-[86%] shrink-0 animate-pulse bg-gray-100 sm:h-[450px] sm:w-[calc((100%-10px)/2)] lg:h-[480px] lg:w-[calc((100%-20px)/3)]"
              />
            ))}
          </div>
        ) : featuredCats.length > 0 ? (
          <>
            <CategoryCarousel items={featuredCats} />
            <div className="mt-10 text-center">
              <Link
                to="/catalog?cat=all"
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-8 py-3.5 font-heading text-sm font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549]"
              >
                Показать все категории
                <i className="fas fa-arrow-right text-xs"></i>
              </Link>
            </div>
          </>
        ) : catalogStatus === 'error' ? (
          <div className="container mx-auto px-6">
            <CatalogError compact />
          </div>
        ) : (
          <div className="container mx-auto px-6">
            <div className="rounded-3xl border-2 border-dashed border-gray-100 py-16 text-center text-gray-400">
              Каталог наполняется — загляните чуть позже или позвоните нам, мы подберём товар вручную.
            </div>
          </div>
        )}
      </section>

      {/* Product showcase — the homepage used to show categories only, so nothing
          on it was actually buyable without two more clicks. */}
      {showcase.length > 0 ? (
        <section className="bg-gray-50 py-20">
          <div className="container mx-auto px-6">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Подборка</div>
                <h2 className="font-display text-3xl italic text-[#1D2B49] md:text-4xl">Популярные товары</h2>
                <div className="mt-3 h-1 w-16 rounded-full bg-[#CEA549]" />
              </div>
              <Link
                to="/catalog?cat=all"
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-3 font-heading text-sm font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549]"
              >
                Весь каталог
                <i className="fas fa-arrow-right text-xs"></i>
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {showcase.map((product, idx) => (
                <Reveal key={product.id} index={idx} className="h-full">
                  <ProductCard product={product} onAddToCart={onAddToCart} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Color / finish swatches */}
      {siteSettings?.colorSwatches && siteSettings.colorSwatches.length > 0 ? (
        <section className="py-20 bg-white">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <div className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Материалы</div>
              <h2 className="font-display italic text-3xl md:text-4xl text-[#1D2B49]">Цвета и покрытия</h2>
              <div className="w-16 h-1 bg-[#CEA549] rounded-full mt-3 mx-auto" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-6">
              {siteSettings.colorSwatches.map((sw, idx) => {
                const img = normalizeAssetUrl(sw.image);
                return (
                  <Reveal key={`${sw.code}-${idx}`} index={idx} className="text-center group" as="div">
                    <div title={sw.title}>
                      <div className="aspect-square rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm group-hover:shadow-lg transition-all">
                        {img ? (
                          <img src={img} alt={sw.title || sw.code} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300">
                            <i className="fas fa-droplet"></i>
                          </div>
                        )}
                      </div>
                      <div className="mt-3">
                        <div className="inline-block text-xs font-bold text-[#1D2B49] uppercase tracking-wider border-b-2 border-[#CEA549] pb-1">
                          {sw.code}
                        </div>
                        {sw.title ? <div className="text-[11px] text-gray-400 mt-1 truncate">{sw.title}</div> : null}
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {/* Trust signals */}
      <section className="py-20 bg-white" id="about">
        <div className="container mx-auto px-6">
          <div className="text-center mb-12">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Почему мы</div>
            <h2 className="font-display italic text-3xl md:text-4xl text-[#1D2B49]">О компании</h2>
            <div className="w-16 h-1 bg-[#CEA549] rounded-full mt-3 mx-auto" />
          </div>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_SIGNALS.map((item, idx) => (
              <Reveal key={item.title} index={idx} className="group text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1D2B49] text-2xl text-[#CEA549] transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-[#CEA549] group-hover:text-white">
                  <i className={`fas ${item.icon}`}></i>
                </div>
                <div className="font-heading font-bold text-[#1D2B49]">{item.title}</div>
                <div className="mt-1 text-sm text-gray-500">{item.desc}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Featured finish family — an editorial block built around the one thing
          this catalog actually has a lot of: the same model in many finishes. */}
      {featuredProduct ? (
        <section className="relative overflow-hidden bg-[#F6F7F9] py-12 md:py-14">
          <div className="pointer-events-none absolute -right-32 top-1/2 hidden h-[420px] w-[420px] -translate-y-1/2 rounded-full bg-[#CEA549]/[0.07] blur-3xl lg:block" />

          <div className="container relative mx-auto px-6">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
              <Reveal className="lg:col-span-6">
                {/* Capped so the packshot isn't swimming in an oversized sheet
                    of white once its height is constrained. */}
                <div className="relative mx-auto w-full max-w-[520px]">
                  {/* Thin gold rule offset behind the card — editorial framing
                      that keeps the plain white product sheet from floating. */}
                  <div className="absolute -left-3 -top-3 hidden h-20 w-20 border-l border-t border-[#CEA549]/60 sm:block" />
                  <div className="relative overflow-hidden rounded-[28px] bg-white p-6 shadow-[0_24px_60px_-30px_rgba(29,43,73,0.35)] sm:p-8">
                    {/* Packshots are portrait (roughly 890x1080), so capping the
                        height rather than the width is what keeps the block
                        inside one screen. */}
                    <img
                      key={featuredProduct.id}
                      src={getProductImages(featuredProduct)[0]}
                      alt={featuredProduct.name}
                      className="animate-fadeIn mx-auto h-[260px] w-auto max-w-full object-contain sm:h-[320px] lg:h-[380px]"
                    />
                  </div>
                </div>
              </Reveal>

              {/* Width-capped: across a full half of a wide container the spec
                  rows stretch into label-here / value-way-over-there. */}
              <Reveal className="lg:col-span-6 lg:max-w-[600px]">
                <div className="mb-4 flex items-center gap-3">
                  <span className="h-px w-8 bg-[#CEA549]" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#CEA549]">
                    Выбор Bathroom Design
                  </span>
                </div>

                {featuredProduct.brand ? (
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
                    {featuredProduct.brand}
                  </div>
                ) : null}

                {/* Product names here are long and technical ("Встраиваемый
                    однорычажный смеситель с 2 выходами") — the display italic
                    used for section titles turns them into a wall of serif.
                    The finish and SKU are stripped out: the swatch row below
                    already names the finish. */}
                <h2 className="font-heading text-2xl font-semibold leading-tight text-[#1D2B49] md:text-[1.75rem]">
                  {productFamilyName(featured?.hero || featuredProduct)}
                </h2>

                {featuredSpecs.length > 0 ? (
                  <dl className="mt-5 space-y-0 border-t border-gray-200/80">
                    {featuredSpecs.map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-6 border-b border-gray-200/80 py-1.5 text-sm">
                        <dt className="text-gray-400">{key}</dt>
                        <dd className="text-right font-medium text-[#1D2B49]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {featured && featured.finishes.length > 1 ? (
                  <div className="mt-5">
                    <div className="mb-2.5 flex items-baseline gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#1D2B49]">
                        {featured.finishes.length} покрытий
                      </span>
                      <span className="truncate text-xs text-gray-400">
                        — {getProductColor(featuredProduct) || 'выберите покрытие'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {featured.finishes.map(({ product, color }, idx) => {
                        const swatch = finishSwatch(color);
                        const isActive = idx === activeFinish;
                        return (
                          <button
                            key={product.id}
                            type="button"
                            onMouseEnter={() => setActiveFinish(idx)}
                            onFocus={() => setActiveFinish(idx)}
                            onClick={() => setActiveFinish(idx)}
                            title={color}
                            aria-label={`Покрытие: ${color}`}
                            aria-pressed={isActive}
                            className={`h-8 w-8 rounded-full transition-all ${
                              isActive
                                ? 'ring-2 ring-[#1D2B49] ring-offset-2 ring-offset-[#F6F7F9]'
                                : 'ring-1 ring-black/10 hover:ring-[#CEA549] hover:ring-2'
                            }`}
                            style={{
                              background: swatch.background,
                              boxShadow: swatch.border ? `inset 0 0 0 1px ${swatch.border}` : undefined,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap items-baseline gap-3">
                  <div className="font-heading text-2xl font-semibold text-[#1D2B49] md:text-[1.75rem]">
                    {displayPrice(featuredProduct)}
                  </div>
                  <span className="text-sm text-gray-400">за {featuredProduct.unit}</span>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    to={productPath(featuredProduct)}
                    className="inline-flex items-center gap-2 rounded-full bg-[#1D2B49] px-7 py-3 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
                  >
                    Подробнее
                    <i className="fas fa-arrow-right text-xs"></i>
                  </Link>
                  <button
                    type="button"
                    onClick={() => onAddToCart(featuredProduct)}
                    className="inline-flex items-center gap-2 rounded-full border border-[#1D2B49]/20 bg-white px-7 py-3 font-heading font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549]"
                  >
                    <i className="fas fa-cart-plus text-sm"></i>
                    В корзину
                  </button>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      ) : null}

      {/* Contacts + Lead form */}
      <section className="relative overflow-hidden bg-[#1D2B49] py-20 text-white" id="contacts">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
        <div className="container relative mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Контакты</div>
              <h2 className="text-3xl md:text-4xl font-heading font-semibold mb-3">Свяжитесь с нами</h2>
              <div className="w-16 h-1 bg-[#CEA549] rounded-full mb-8" />
              <p className="text-white/70 text-lg mb-12">
                Остались вопросы? Оставьте заявку, и наши менеджеры свяжутся с вами для консультации.
              </p>

              <div className="space-y-6">
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-xl">
                    <i className="fas fa-phone"></i>
                  </div>
                  <div>
                    <div className="text-white/50 text-xs font-bold uppercase mb-1">Телефон</div>
                    <a href={`tel:${contactPhone.replace(/\s/g, '')}`} className="text-xl font-bold">{contactPhone}</a>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-xl">
                    <i className="fas fa-envelope"></i>
                  </div>
                  <div>
                    <div className="text-white/50 text-xs font-bold uppercase mb-1">Email</div>
                    <a href={`mailto:${contactEmail}`} className="text-xl font-bold">{contactEmail}</a>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-xl">
                    <i className="fas fa-map-marker-alt"></i>
                  </div>
                  <div>
                    <div className="text-white/50 text-xs font-bold uppercase mb-1">Адрес</div>
                    <span className="text-xl font-bold">{contactAddress}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-2xl text-gray-900">
              <h3 className="text-2xl font-heading font-semibold text-[#1D2B49] mb-8">Быстрая заявка</h3>
              <LeadForm />
            </div>
          </div>
        </div>
      </section>

      {typeof document !== 'undefined' && leadModal ? createPortal(leadModal, document.body) : null}
      {typeof document !== 'undefined' && leadSuccessModal ? createPortal(leadSuccessModal, document.body) : null}
    </div>
  );
};

export default HomePage;
