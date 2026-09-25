import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CatalogStatus, Category, Product } from '../types';
import { applySeo } from '../utils/seo';
import {
  displayPrice,
  discountPercent,
  formatPrice,
  getProductImages,
  normalizeAttrEntries,
  productPath,
} from '../utils/product';
import ProductCard from '../components/ProductCard';
import { CatalogError } from '../components/CatalogState';

const SITE_URL = 'https://bathroomdesign.kz';

interface ProductPageProps {
  categories: Category[];
  catalogStatus: CatalogStatus;
  onRetryCatalog: () => void;
  onAddToCart: (p: Product) => void;
  /** Shop phone from site settings — doubles as the WhatsApp for price requests. */
  phone?: string;
}

const BENEFITS = [
  { icon: 'fa-truck', text: 'Доставка по Алматы и всему Казахстану' },
  { icon: 'fa-shield-halved', text: 'Официальная гарантия производителя' },
  { icon: 'fa-rotate-left', text: 'Обмен и возврат по закону РК' },
];

const ProductPage: React.FC<ProductPageProps> = ({
  categories,
  catalogStatus,
  onRetryCatalog,
  onAddToCart,
  phone,
}) => {
  const { id = '' } = useParams();
  const [imageIndex, setImageIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [quantity, setQuantity] = useState(1);

  // The whole catalog arrives in one request (see App.fetchCatalog): until it
  // lands, a missing product means "not loaded yet", not "doesn't exist".
  const isCatalogLoading = catalogStatus === 'loading';
  const product = useMemo(
    () => categories.flatMap((c) => c.items || []).find((p) => p.id === id),
    [categories, id]
  );
  const category = useMemo(
    () => categories.find((c) => c.id === product?.category_id),
    [categories, product]
  );

  const images = product ? getProductImages(product) : [];
  // Supplier keys land in the table exactly as typed — a lowercase latin
  // "color" next to "Ширина" looks like a leak. Also drop the collection row:
  // it already sits in the meta line under the title.
  const attrs = product
    ? normalizeAttrEntries(product.attrs)
        .filter(([key]) => !(product.collection && /^(коллекция|collection)$/i.test(key.trim())))
        .map(([key, value]) => [key.charAt(0).toUpperCase() + key.slice(1), value] as [string, string])
    : [];
  const discount = product ? discountPercent(product) : 0;

  const related = useMemo(() => {
    if (!product) return [];
    const sameCollection = (category?.items || []).filter(
      (p) => p.id !== product.id && p.collection && p.collection === product.collection
    );
    const sameCategory = (category?.items || []).filter(
      (p) => p.id !== product.id && !sameCollection.some((s) => s.id === p.id)
    );
    return [...sameCollection, ...sameCategory].slice(0, 4);
  }, [product, category]);

  // A new product id means a new gallery and a fresh quantity.
  useEffect(() => {
    setImageIndex(0);
    setIsZoomed(false);
    setQuantity(1);
  }, [id]);

  // Tells the site-wide WhatsApp button to move above the mobile buy bar
  // (see .wa-fab in index.css).
  useEffect(() => {
    document.body.setAttribute('data-buybar', '1');
    return () => document.body.removeAttribute('data-buybar');
  }, []);

  useEffect(() => {
    if (!isZoomed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsZoomed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isZoomed]);

  useEffect(() => {
    if (!product) return;
    const url = `${SITE_URL}${productPath(product)}`;
    const image = images[0] ? new URL(images[0], window.location.origin).href : undefined;

    // Mirrors the visual breadcrumb nav above exactly (Главная / Каталог /
    // [категория] / название) so the rich-result trail Google/Yandex show
    // never disagrees with what's actually on the page.
    const breadcrumbItems = [
      { name: 'Главная', item: SITE_URL },
      { name: 'Каталог', item: `${SITE_URL}/catalog` },
      ...(category ? [{ name: category.title, item: `${SITE_URL}/catalog?cat=${category.id}` }] : []),
      { name: product.name, item: url },
    ];

    return applySeo({
      title: `${product.name} — купить в Алматы | Bathroom Design`,
      description:
        String(product.description || '').replace(/\s+/g, ' ').trim() ||
        `${product.name}${product.brand ? ` (${product.brand})` : ''} — ${category?.title || 'каталог'} Bathroom Design.`,
      canonicalUrl: url,
      ogUrl: url,
      ogType: 'product',
      ogImage: image,
      twitterCard: 'summary_large_image',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          sku: product.sku || undefined,
          brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
          image: image ? [image] : undefined,
          description: product.description || undefined,
          offers: product.prices.retail
            ? {
                '@type': 'Offer',
                price: product.prices.retail,
                priceCurrency: 'KZT',
                url,
                availability: product.inStock
                  ? 'https://schema.org/InStock'
                  : 'https://schema.org/PreOrder',
              }
            : undefined,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: breadcrumbItems.map((b, idx) => ({
            '@type': 'ListItem',
            position: idx + 1,
            name: b.name,
            item: b.item,
          })),
        },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, category]);

  if (isCatalogLoading) {
    return (
      <div className="container mx-auto animate-pulse px-4 py-10 sm:px-6">
        <div className="mb-8 h-4 w-64 rounded bg-gray-100" />
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div className="aspect-square rounded-3xl bg-gray-100" />
          <div className="space-y-4">
            <div className="h-8 w-3/4 rounded bg-gray-100" />
            <div className="h-4 w-1/3 rounded bg-gray-100" />
            <div className="h-28 rounded-3xl bg-gray-100" />
            <div className="h-12 w-full rounded-full bg-gray-100" />
          </div>
        </div>
      </div>
    );
  }

  if (catalogStatus === 'error') {
    return (
      <div className="container mx-auto px-4 py-16 sm:px-6">
        <CatalogError onRetry={onRetryCatalog} />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-6 py-24 text-center">
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-gray-50 text-3xl text-gray-300">
          <i className="fas fa-box-open"></i>
        </div>
        <h1 className="mb-3 font-heading text-3xl font-semibold text-[#1D2B49]">Товар не найден</h1>
        <p className="mx-auto mb-8 max-w-md text-gray-500">
          Возможно, он был снят с продажи или ссылка устарела. Посмотрите другие товары в каталоге.
        </p>
        <Link
          to="/catalog"
          className="inline-flex rounded-full bg-[#1D2B49] px-8 py-3.5 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
        >
          Перейти в каталог
        </Link>
      </div>
    );
  }

  const addToCart = () => {
    for (let i = 0; i < quantity; i += 1) onAddToCart(product);
  };

  // Most of the catalog has no retail price yet, and "По запросу" with only an
  // add-to-cart button leaves the customer with no way to actually ask. The ask
  // goes straight to WhatsApp — same number as the cart request, same shape of
  // message: name, article and a link back to this page for the photo.
  const hasPrice = Boolean(product.prices.retail);
  const priceRequestUrl = (() => {
    const target = String(phone || import.meta.env.VITE_WHATSAPP_PHONE || '').replace(/\D/g, '');
    if (!target) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : SITE_URL;
    const text = [
      `Здравствуйте! Подскажите цену и наличие:`,
      `${product.name}${product.sku ? ` (арт. ${product.sku})` : ''}`,
      `${origin}${productPath(product)}`,
    ].join('\n');
    return `https://wa.me/${target}?text=${encodeURIComponent(text)}`;
  })();

  // Article / collection / subcategory read as one line of identifiers rather
  // than three differently-shaped labels scattered next to the stock badge.
  const meta = [
    product.sku ? { label: 'Артикул', value: product.sku } : null,
    product.collection ? { label: 'Коллекция', value: product.collection } : null,
    product.subcategory ? { label: 'Подкатегория', value: product.subcategory } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="pb-28 lg:pb-0">
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-10">
        <nav aria-label="Хлебные крошки" className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
          <Link to="/" className="transition-colors hover:text-[#CEA549]">Главная</Link>
          <span>/</span>
          <Link to="/catalog" className="transition-colors hover:text-[#CEA549]">Каталог</Link>
          {category ? (
            <>
              <span>/</span>
              <Link to={`/catalog?cat=${category.id}`} className="transition-colors hover:text-[#CEA549]">
                {category.title}
              </Link>
            </>
          ) : null}
          <span>/</span>
          <span className="font-semibold text-[#1D2B49]">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-14">
          {/* Gallery */}
          <div className="lg:sticky lg:top-32 lg:self-start">
            <div className="relative overflow-hidden rounded-3xl border border-gray-100 bg-gray-50">
              {images[imageIndex] ? (
                <button
                  type="button"
                  onClick={() => setIsZoomed(true)}
                  className="block aspect-square w-full cursor-zoom-in"
                  aria-label="Увеличить изображение"
                >
                  <img src={images[imageIndex]} alt={product.name} className="h-full w-full object-contain" />
                </button>
              ) : (
                <div className="flex aspect-square w-full items-center justify-center text-5xl text-gray-300">
                  <i className="fas fa-bath"></i>
                </div>
              )}

              {discount > 0 ? (
                <span className="absolute left-4 top-4 rounded-full bg-[#CEA549] px-3 py-1.5 text-xs font-bold text-white">
                  −{discount}%
                </span>
              ) : null}

              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setImageIndex((i) => (i - 1 + images.length) % images.length)}
                    aria-label="Предыдущее фото"
                    className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#1D2B49] shadow-lg transition-all hover:bg-white"
                  >
                    <i className="fas fa-chevron-left"></i>
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageIndex((i) => (i + 1) % images.length)}
                    aria-label="Следующее фото"
                    className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#1D2B49] shadow-lg transition-all hover:bg-white"
                  >
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </>
              ) : null}
            </div>

            {images.length > 1 ? (
              <div className="scrollbar-hide mt-3 flex gap-2 overflow-x-auto pb-1">
                {images.map((img, idx) => (
                  <button
                    key={`${img}-${idx}`}
                    type="button"
                    onClick={() => setImageIndex(idx)}
                    aria-label={`Фото ${idx + 1}`}
                    aria-current={idx === imageIndex}
                    className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl border-2 bg-white transition-all ${
                      idx === imageIndex ? 'border-[#CEA549]' : 'border-gray-100 hover:border-gray-300'
                    }`}
                  >
                    {/* contain, like the main image — cover was cropping the product out */}
                    <img src={img} alt="" className="h-full w-full object-contain p-1" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Buy column */}
          <div>
            {/* Brand and availability are both status chips — same shape, same row. */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {product.brand ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#1D2B49]">
                  {product.brand}
                </span>
              ) : null}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                  product.inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${product.inStock ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                {product.inStock ? 'В наличии' : 'Под заказ'}
              </span>
            </div>

            <h1 className="font-heading text-2xl font-semibold leading-tight text-gray-900 sm:text-3xl">
              {product.name}
            </h1>

            {meta.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
                {meta.map((m, idx) => (
                  <React.Fragment key={m.label}>
                    {idx > 0 ? <span className="text-gray-300">·</span> : null}
                    <span>
                      {m.label} <span className="font-semibold text-gray-600">{m.value}</span>
                    </span>
                  </React.Fragment>
                ))}
              </div>
            ) : null}

            {hasPrice ? (
              <div className="mt-6 rounded-3xl bg-[#1D2B49] p-6 text-white">
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[#CEA549]">
                  Цена за {product.unit}
                </div>
                <div className="flex flex-wrap items-baseline gap-3">
                  <div className="font-heading text-3xl font-semibold sm:text-4xl">{displayPrice(product)}</div>
                  {product.prices.oldPrice ? (
                    <div className="text-lg text-white/50 line-through">{formatPrice(product.prices.oldPrice)}</div>
                  ) : null}
                </div>
              </div>
            ) : (
              /* A big navy panel announcing "По запросу" was a lot of weight for
                 a non-answer — say what happens next instead. */
              <div className="mt-6 rounded-3xl border border-[#CEA549]/30 bg-[#CEA549]/[0.07] px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <i className="fas fa-tag text-sm text-[#CEA549]"></i>
                  <span className="font-heading text-lg font-semibold text-[#1D2B49]">Цена по запросу</span>
                </div>
                <p className="mt-1.5 text-sm text-gray-500">
                  Менеджер назовёт актуальную цену и наличие в течение 30 минут.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="inline-flex items-center overflow-hidden rounded-full border-2 border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label="Уменьшить количество"
                  className="px-4 py-3 text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <i className="fas fa-minus text-xs"></i>
                </button>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  aria-label="Количество"
                  className="w-14 border-x border-gray-200 py-3 text-center text-base font-bold outline-none"
                />
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  aria-label="Увеличить количество"
                  className="px-4 py-3 text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <i className="fas fa-plus text-xs"></i>
                </button>
              </div>

              {hasPrice ? (
                <button
                  type="button"
                  onClick={addToCart}
                  className="flex flex-grow items-center justify-center gap-2 rounded-full bg-[#1D2B49] px-6 py-3.5 font-heading text-base font-semibold text-white transition-all hover:bg-[#152036]"
                >
                  <i className="fas fa-cart-plus"></i>
                  Добавить в корзину
                </button>
              ) : priceRequestUrl ? (
                <a
                  href={priceRequestUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-grow items-center justify-center gap-2 rounded-full bg-[#1D2B49] px-6 py-3.5 font-heading text-base font-semibold text-white transition-all hover:bg-[#152036]"
                >
                  <i className="fas fa-tag text-sm"></i>
                  Узнать цену
                </a>
              ) : null}
            </div>

            {!hasPrice ? (
              <button
                type="button"
                onClick={addToCart}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-[#1D2B49]/20 px-6 py-3 font-heading text-base font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549]"
              >
                <i className="fas fa-cart-plus text-sm"></i>
                Добавить в корзину
              </button>
            ) : null}

            <ul className="mt-6 space-y-2.5 rounded-3xl border border-gray-100 bg-gray-50 p-5">
              {BENEFITS.map((b) => (
                <li key={b.text} className="flex items-center gap-3 text-sm text-gray-600">
                  <i className={`fas ${b.icon} w-4 text-[#CEA549]`}></i>
                  {b.text}
                </li>
              ))}
            </ul>

            {product.description ? (
              <div className="mt-8 border-t border-gray-100 pt-8">
                <h2 className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-gray-400">Описание</h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{product.description}</p>
              </div>
            ) : null}

            {attrs.length > 0 ? (
              <div className="mt-8 border-t border-gray-100 pt-8">
                <h2 className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-gray-400">Характеристики</h2>
                <dl className="overflow-hidden rounded-2xl border border-gray-100">
                  {attrs.map(([key, value], idx) => (
                    <div
                      key={`${key}-${idx}`}
                      className={`grid grid-cols-2 gap-4 px-4 py-3 text-sm ${idx % 2 ? 'bg-white' : 'bg-gray-50'}`}
                    >
                      <dt className="break-words text-gray-500">{key}</dt>
                      <dd className="break-words font-medium text-gray-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </div>

        {related.length > 0 ? (
          <section className="mt-16 border-t border-gray-100 pt-10">
            <div className="mb-6 flex items-end justify-between gap-4">
              <h2 className="font-heading text-xl font-semibold text-[#1D2B49] sm:text-2xl">Похожие товары</h2>
              {category ? (
                <Link
                  to={`/catalog?cat=${category.id}`}
                  className="flex-shrink-0 text-sm font-semibold text-gray-400 transition-colors hover:text-[#CEA549]"
                >
                  Вся категория →
                </Link>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} onAddToCart={onAddToCart} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {/* Mobile buy bar — the desktop button scrolls away on a long spec list. */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-100 bg-white/95 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-shrink">
            <div className="truncate font-heading text-lg font-semibold text-[#1D2B49]">{displayPrice(product)}</div>
            <div className="text-[11px] text-gray-400">{hasPrice ? `за ${product.unit}` : 'уточним за 30 мин'}</div>
          </div>
          {!hasPrice && priceRequestUrl ? (
            <a
              href={priceRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-grow items-center justify-center gap-2 rounded-full bg-[#1D2B49] px-5 py-3 font-heading text-sm font-semibold text-white transition-all hover:bg-[#152036]"
            >
              <i className="fas fa-tag text-xs"></i>
              Узнать цену
            </a>
          ) : null}
          <button
            type="button"
            onClick={addToCart}
            aria-label="Добавить в корзину"
            className={`flex flex-shrink-0 items-center justify-center gap-2 rounded-full px-5 py-3 font-heading text-sm font-semibold transition-all ${
              hasPrice
                ? 'flex-grow bg-[#1D2B49] text-white hover:bg-[#152036]'
                : 'border border-[#1D2B49]/20 text-[#1D2B49] hover:border-[#CEA549]'
            }`}
          >
            <i className="fas fa-cart-plus"></i>
            <span className={hasPrice ? '' : 'sr-only'}>В корзину</span>
          </button>
        </div>
      </div>

      {isZoomed && images[imageIndex] ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-6"
          onClick={() => setIsZoomed(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setIsZoomed(false)}
            aria-label="Закрыть"
            className="absolute right-6 top-6 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <i className="fas fa-times text-lg"></i>
          </button>
          <img
            src={images[imageIndex]}
            alt={product.name}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
};

export default ProductPage;
