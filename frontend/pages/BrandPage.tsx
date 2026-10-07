import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Brand, CatalogStatus, Category, Product } from '../types';
import { applySeo } from '../utils/seo';
import { fetchBrands } from '../services/api';
import ProductCard from '../components/ProductCard';
import { CatalogError, ProductGridSkeleton } from '../components/CatalogState';
import NotFoundPage from './NotFoundPage';

const SITE_URL = 'https://bathroomdesign.kz';
const PAGE_SIZE = 24;

interface BrandPageProps {
  categories: Category[];
  catalogStatus: CatalogStatus;
  onRetryCatalog: () => void;
  onAddToCart: (p: Product) => void;
}

/**
 * Landing page for a single catalog brand.
 *
 * Brands used to exist only as a checkbox inside the catalog filters, so
 * searches like "Allen Brau сантехника Астана" — the exact shape of query
 * competitors win with dedicated brand pages — had nothing on this site to
 * match. The server renders a full HTML version of this page for crawlers
 * (backend services/seoRender.js); this component is what users get.
 *
 * The slug→name mapping deliberately comes from /api/brands rather than being
 * recomputed here: the server owns transliteration, and a second
 * implementation on the client would eventually disagree with the sitemap.
 */
const BrandPage: React.FC<BrandPageProps> = ({
  categories,
  catalogStatus,
  onRetryCatalog,
  onAddToCart,
}) => {
  const { slug = '' } = useParams();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandsFailed, setBrandsFailed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    fetchBrands()
      .then((data) => {
        if (!cancelled) setBrands(data.brands || []);
      })
      .catch(() => {
        if (!cancelled) setBrandsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => setVisibleCount(PAGE_SIZE), [slug]);

  const brand = useMemo(
    () => (brands || []).find((b) => b.slug === slug),
    [brands, slug]
  );

  const products = useMemo(() => {
    if (!brand) return [];
    return categories
      .flatMap((c) => c.items || [])
      .filter((p) => (p.brand || '').trim() === brand.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [categories, brand]);

  // Which categories this brand spans — turns generic copy into something
  // specific ("смесители, инсталляции") and gives crawlers internal links.
  const spannedCategories = useMemo(() => {
    if (!brand) return [];
    const ids = new Set(products.map((p) => p.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [categories, products, brand]);

  useEffect(() => {
    if (!brand) return;
    const spans = spannedCategories.map((c) => c.title.toLowerCase()).slice(0, 4).join(', ');
    return applySeo({
      title: `${brand.name} — сантехника в Астане | Bathroom Design`,
      description:
        `${brand.name} в Астане — ${brand.count} товаров в наличии в салоне Bathroom Design, ` +
        `ул. Розы Баглановой, 2${spans ? `. В ассортименте: ${spans}` : ''}. ` +
        `Консультация и доставка по Казахстану.`,
      canonicalUrl: `${SITE_URL}/brand/${brand.slug}`,
      ogUrl: `${SITE_URL}/brand/${brand.slug}`,
      ogType: 'website',
      twitterCard: 'summary_large_image',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Главная', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: 'Каталог', item: `${SITE_URL}/catalog` },
            {
              '@type': 'ListItem',
              position: 3,
              name: brand.name,
              item: `${SITE_URL}/brand/${brand.slug}`,
            },
          ],
        },
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: `${brand.name} — сантехника`,
          url: `${SITE_URL}/brand/${brand.slug}`,
          about: { '@type': 'Brand', name: brand.name },
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: brand.count,
            itemListElement: products.slice(0, 30).map((p, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              url: `${SITE_URL}/product/${p.id}`,
              name: p.name,
            })),
          },
        },
      ],
    });
  }, [brand, products, spannedCategories]);

  // Both lists must be in before a missing brand means anything: the brand
  // list resolves the slug, the catalog supplies the products.
  const isLoading = brands === null || catalogStatus === 'loading';

  if (brandsFailed || catalogStatus === 'error') {
    return (
      <div className="container mx-auto px-6 py-16">
        <CatalogError onRetry={onRetryCatalog} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-16">
        <div className="mb-8 h-9 w-72 animate-pulse rounded bg-gray-100" />
        <ProductGridSkeleton />
      </div>
    );
  }

  if (!brand) return <NotFoundPage />;

  const visible = products.slice(0, visibleCount);

  return (
    <div className="container mx-auto px-6 py-12">
      <nav className="mb-6 text-sm text-gray-400">
        <Link to="/" className="transition-colors hover:text-[#CEA549]">Главная</Link>
        <span className="mx-2">/</span>
        <Link to="/catalog" className="transition-colors hover:text-[#CEA549]">Каталог</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-600">{brand.name}</span>
      </nav>

      <h1 className="font-heading text-3xl font-semibold text-[#1D2B49] sm:text-4xl">
        {brand.name} — сантехника в Астане
      </h1>
      <p className="mt-3 max-w-2xl text-gray-500">
        {products.length} товаров бренда {brand.name} в салоне Bathroom Design, ул. Розы Баглановой, 2.
        {spannedCategories.length > 0
          ? ` В ассортименте: ${spannedCategories.map((c) => c.title.toLowerCase()).join(', ')}.`
          : ''}
      </p>

      {spannedCategories.length > 1 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {spannedCategories.map((c) => (
            <Link
              key={c.id}
              to={`/catalog/${c.slug || ''}`}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm text-[#1D2B49] transition-colors hover:border-[#CEA549] hover:text-[#CEA549]"
            >
              {c.title}
            </Link>
          ))}
        </div>
      ) : null}

      {products.length === 0 ? (
        <p className="mt-12 text-gray-500">Товары этого бренда сейчас не в наличии.</p>
      ) : (
        <>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => (
              <ProductCard key={p.id} product={p} onAddToCart={onAddToCart} />
            ))}
          </div>

          {visibleCount < products.length ? (
            <div className="mt-10 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="inline-flex rounded-full bg-[#1D2B49] px-8 py-3.5 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
              >
                Показать ещё {Math.min(PAGE_SIZE, products.length - visibleCount)}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default BrandPage;
