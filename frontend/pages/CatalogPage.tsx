import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CatalogStatus, Category, Product } from '../types';
import { applySeo } from '../utils/seo';
import CategoryHero from '../components/CategoryHero';
import ProductCard from '../components/ProductCard';
import { CatalogError, ProductGridSkeleton } from '../components/CatalogState';
import {
  dedupeByNormalized,
  getProductColor,
  normalizeAttrEntries,
  normalizeValue,
} from '../utils/product';

const formatSeoValue = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

/** How many cards to render before "Показать ещё" — the full catalog is ~350
 *  products and rendering them all made the page ~200 000 px tall. */
const PAGE_SIZE = 24;

/** Attribute keys that are logistics/import metadata from the Excel feed
 *  (packaging dimensions, net/gross weight, manufacturer's internal SKU) —
 *  never useful as a shopper-facing filter, so they're dropped regardless of
 *  how many products carry them. */
const BLOCKED_ATTR_PATTERN = /нетто|брутто|упаковк|артикул/i;

/** Attribute keys that exactly duplicate a field with its own dedicated
 *  filter section (color, brand, collection) — the Excel "Характеристики"
 *  column often repeats these verbatim (e.g. `attrs.Коллекция` ===
 *  `product.collection` on every row checked), so showing them again as a
 *  generic attr group would just be the same filter twice. "Название цвета"
 *  is deliberately NOT here — it carries a finer-grained color name than the
 *  bucketed `attrs.Цвет`/`product` color (e.g. "Черный" vs "Черный матовый"),
 *  so it's a genuinely different filter. */
const DUPLICATE_ATTR_KEY_PATTERN = /^(color|цвет|brand|бренд|collection|коллекция)$/i;

/** Caps how many dynamic attribute filter groups render per category. The
 *  catalog's attrs are free-form per-import and can carry 50-100+ distinct
 *  keys once every category is flattened ("Все категории") — showing them
 *  all buried the handful shoppers actually use (material, mount type,
 *  shape...) under noise. Keeping only the most-filled groups (see
 *  availableAttrs below) surfaces what's actually common in the current view. */
const MAX_ATTR_FILTER_GROUPS = 8;

type CatalogDerived = {
  categoryProducts: Product[];
  availableColors: string[];
  allCatalogBrands: string[];
  availableCollections: string[];
  availableAttrs: Record<string, string[]>;
  colorCounts: Map<string, number>;
  brandCounts: Map<string, number>;
  collectionCounts: Map<string, number>;
  attrValueCounts: Map<string, Map<string, number>>;
};

/** Survives this component unmounting (e.g. navigating to a product and back),
 *  unlike a useMemo cache — see the `derived` useMemo below for why that
 *  matters. Keyed by the `categories` array identity so a catalog refetch
 *  (new array) naturally starts a fresh cache. */
const catalogDerivedCache = new WeakMap<Category[], Map<string, CatalogDerived>>();

interface FilterGroupProps {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** Rows visible inside an expanded group before "Показать ещё". */
const FILTER_ROWS_PREVIEW = 8;

// Collapsible filter section — keeps the sidebar short by default when a
// category has many brands/colors/attrs, while still letting an active
// filter reveal itself (see isGroupOpen below). Long value lists (a category
// can carry 25 sizes) are additionally capped so one group can't push every
// other filter out of reach.
const FilterGroup: React.FC<FilterGroupProps> = ({ title, count, open, onToggle, children }) => {
  const [showAll, setShowAll] = useState(false);
  const rows = React.Children.toArray(children);
  const isCapped = !showAll && rows.length > FILTER_ROWS_PREVIEW + 2;
  const visibleRows = isCapped ? rows.slice(0, FILTER_ROWS_PREVIEW) : rows;

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 py-4 text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#CEA549]/50 group"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-black text-[#1D2B49] uppercase tracking-widest truncate">{title}</span>
          {count > 0 ? (
            <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#CEA549] text-white text-[10px] font-bold">
              {count}
            </span>
          ) : null}
        </span>
        <i
          className={`fas fa-chevron-down text-[10px] text-gray-300 group-hover:text-[#1D2B49] transition-all ${open ? 'rotate-180' : ''}`}
        ></i>
      </button>
      {open ? (
        <div className="pb-4 space-y-0.5">
          {visibleRows}
          {rows.length > FILTER_ROWS_PREVIEW + 2 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-1 px-3 py-1.5 text-xs font-semibold text-[#CEA549] transition-colors hover:text-[#1D2B49]"
            >
              {showAll ? 'Свернуть' : `Показать ещё ${rows.length - FILTER_ROWS_PREVIEW}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

interface FilterRowProps {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
  /** Value exists in the catalog but not in the current category. */
  muted?: boolean;
  title?: string;
}

// One checkbox line. Deliberately wraps instead of truncating — colour names
// like "Брашированный матовый никель" were being cut off mid-word before.
const FilterRow: React.FC<FilterRowProps> = ({ label, count, checked, onChange, muted, title }) => (
  <label
    title={title}
    className={`flex items-start gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
      checked ? 'bg-[#1D2B49]/[0.06]' : 'hover:bg-gray-50'
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="accent-[#1D2B49] w-4 h-4 mt-0.5 flex-shrink-0"
    />
    <span
      className={`flex-grow text-sm leading-snug ${
        muted ? 'text-gray-300' : checked ? 'font-semibold text-[#1D2B49]' : 'text-gray-600'
      }`}
    >
      {label}
    </span>
    {typeof count === 'number' ? (
      <span
        className={`flex-shrink-0 mt-0.5 text-[11px] font-semibold tabular-nums ${
          muted ? 'text-gray-200' : 'text-gray-400'
        }`}
      >
        {count}
      </span>
    ) : null}
  </label>
);

interface CatalogPageProps {
  categories: Category[];
  catalogStatus: CatalogStatus;
  onRetryCatalog: () => void;
  onAddToCart: (p: Product) => void;
}

const CatalogPage: React.FC<CatalogPageProps> = ({ categories, catalogStatus, onRetryCatalog, onAddToCart }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Empty array means "all categories"; one or more ids narrow the view.
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string[]>>({});
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'stock' | 'price-asc' | 'price-desc' | 'name'>('default');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openFilterGroups, setOpenFilterGroups] = useState<Record<string, boolean>>({});
  const [sidebarSticky, setSidebarSticky] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const hasInitedFiltersFromUrl = useRef(false);
  const prevCatIdRef = useRef<string | null>(null);
  // Set when a category switch is itself part of applying a filter (jumping to
  // a brand that lives in other categories), so the reset-on-category-change
  // effect below doesn't immediately wipe the filter we just set.
  const skipFilterResetRef = useRef(false);

  // Keep the selected categories in sync with the `cat` URL params — this is
  // what makes external links (footer/sitemap category links) work while
  // already on this page, not just on first mount. `cat=all` (or no param at
  // all) means every category.
  useEffect(() => {
    if (categories.length === 0) return;
    const raw = searchParams.getAll('cat');
    const resolved = raw.includes('all') ? [] : raw.filter((id) => categories.some((c) => c.id === id));
    setSelectedCatIds((prev) => (prev.join('|') === resolved.join('|') ? prev : resolved));
  }, [searchParams, categories]);

  // Reset the other filters whenever the category selection actually changes
  // (tab click, external link, browser navigation) — but not on the very first
  // populate, so a shared/bookmarked link that carries both `cat` and filters
  // isn't immediately wiped.
  const catKey = selectedCatIds.join('|');
  useEffect(() => {
    if (prevCatIdRef.current !== null && prevCatIdRef.current !== catKey) {
      if (skipFilterResetRef.current) {
        skipFilterResetRef.current = false;
      } else {
        setSelectedColors([]);
        setSelectedBrands([]);
        setSelectedCollections([]);
        setSelectedSubcategories([]);
        setSelectedAttrs({});
        setInStockOnly(false);
      }
    }
    prevCatIdRef.current = catKey;
  }, [catKey]);

  // The search term is kept in sync with `?q` continuously, not just on mount:
  // the header search box navigates here with a new `q` while this page is
  // already mounted, and a mount-only read would silently ignore it.
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    setSearchQuery((prev) => (prev === urlQuery ? prev : urlQuery));
  }, [searchParams]);

  // Parse the remaining filter state (everything but `cat` and `q`, handled
  // above) from the URL once on mount, so shared links restore filters.
  useEffect(() => {
    if (hasInitedFiltersFromUrl.current) return;
    hasInitedFiltersFromUrl.current = true;

    const sortParam = searchParams.get('sort');
    if (sortParam === 'stock' || sortParam === 'price-asc' || sortParam === 'price-desc' || sortParam === 'name') {
      setSortBy(sortParam);
    }

    if (searchParams.get('stock') === '1') setInStockOnly(true);

    const brands = searchParams.getAll('brand');
    if (brands.length > 0) setSelectedBrands(brands);

    const cols = searchParams.getAll('col');
    if (cols.length > 0) setSelectedCollections(cols);

    const subs = searchParams.getAll('sub');
    if (subs.length > 0) setSelectedSubcategories(subs);

    const colors = searchParams.getAll('color');
    if (colors.length > 0) setSelectedColors(colors);

    const attrs: Record<string, string[]> = {};
    for (const [key, value] of searchParams.entries()) {
      if (!key.startsWith('attr:')) continue;
      const attrKey = key.slice(5);
      (attrs[attrKey] ||= []).push(value);
    }
    if (Object.keys(attrs).length > 0) setSelectedAttrs(attrs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in sync with the current filter state (shareable/bookmarkable
  // links). Waits for the catalog so it can't overwrite a deep link with an
  // empty selection before the categories have loaded.
  useEffect(() => {
    if (categories.length === 0) return;
    const params = new URLSearchParams();
    if (selectedCatIds.length === 0) params.set('cat', 'all');
    else selectedCatIds.forEach((id) => params.append('cat', id));
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (sortBy !== 'default') params.set('sort', sortBy);
    if (inStockOnly) params.set('stock', '1');
    selectedBrands.forEach((b) => params.append('brand', b));
    selectedCollections.forEach((c) => params.append('col', c));
    selectedSubcategories.forEach((s) => params.append('sub', s));
    selectedColors.forEach((c) => params.append('color', c));
    Object.keys(selectedAttrs).forEach((key) => {
      (selectedAttrs[key] || []).forEach((v) => params.append(`attr:${key}`, v));
    });
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, catKey, searchQuery, sortBy, inStockOnly, selectedBrands, selectedCollections, selectedSubcategories, selectedColors, selectedAttrs]);

  // Products used to open in a modal addressed as ?product=<id>. Those links are
  // out in the wild (sitemap, shared chats), so send them to the real page.
  useEffect(() => {
    const productId = searchParams.get('product');
    if (productId) navigate(`/product/${encodeURIComponent(productId)}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Tabs pick exactly one category (or all); the sidebar checkboxes below can
  // then add more on top of that.
  const selectCategory = (catId: string) => {
    setSelectedCatIds(catId === 'all' ? [] : [catId]);
  };

  const toggleCategory = (catId: string) => {
    setSelectedCatIds((prev) => (prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]));
  };

  // The mobile filter sheet covers the page — stop the list behind it from
  // scrolling away under the user's finger.
  useEffect(() => {
    if (!filtersOpen || window.innerWidth >= 1024) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [filtersOpen]);

  // Pin the filter sidebar only while it fits on screen. Giving it its own
  // inner scrollbar instead was actively worse: the site-wide Lenis smooth
  // scroll swallows wheel events over the sidebar, so the nested area couldn't
  // be scrolled at all until the page itself had been scrolled to the bottom.
  // Taller than the viewport => plain static block that scrolls with the page,
  // so every filter stays reachable and there is only ever one scrollbar.
  useEffect(() => {
    const recomputeSticky = () => {
      const el = sidebarRef.current;
      if (!el) return;
      const fits = window.innerWidth >= 1024 && el.scrollHeight <= window.innerHeight - 128;
      setSidebarSticky((prev) => (prev === fits ? prev : fits));
    };
    recomputeSticky();
    window.addEventListener('resize', recomputeSticky);
    return () => window.removeEventListener('resize', recomputeSticky);
  });

  const isAllMode = selectedCatIds.length === 0;
  // Hero image, breadcrumb and SEO only make sense for a single category.
  const activeCategory = selectedCatIds.length === 1
    ? categories.find((c) => c.id === selectedCatIds[0])
    : undefined;
  const q = searchQuery.trim().toLowerCase();

  // Filtering/counting ~2600 products (and every free-form attr on each of
  // them) is real CPU work, and it used to redo from scratch on every mount -
  // including the extremely common hop of opening a product card and hitting
  // the browser's back button, which unmounts and remounts this whole page.
  // `categories` keeps the same array identity for the life of a catalog
  // fetch (see App.tsx), so caching the derived bundle per (categories,
  // selected-category-set) turns that repeat visit into an instant cache hit
  // instead of a multi-hundred-ms recompute that made navigation feel stuck.
  const derived = useMemo<CatalogDerived>(() => {
    let byCatKey = catalogDerivedCache.get(categories);
    if (!byCatKey) {
      byCatKey = new Map();
      catalogDerivedCache.set(categories, byCatKey);
    }
    const cached = byCatKey.get(catKey);
    if (cached) return cached;

    const categoryProducts = isAllMode
      ? categories.flatMap((c) => c.items)
      : categories.filter((c) => selectedCatIds.includes(c.id)).flatMap((c) => c.items);

    const availableColors = dedupeByNormalized(categoryProducts.map((p) => getProductColor(p)));

    // Brands are listed catalog-wide rather than per-category: most categories
    // carry only one brand, so a per-category list looked like the filter was
    // broken. Brands absent from the current category render muted with a 0
    // and jump to the all-categories view when clicked (selectBrandAcrossCatalog).
    const allCatalogBrands = categories
      .flatMap((c) => c.items)
      .map((p) => (p.brand || '').trim())
      .filter((brand, idx, arr): brand is string => Boolean(brand) && arr.indexOf(brand) === idx)
      .sort((a, b) => a.localeCompare(b, 'ru'));

    const availableCollections = dedupeByNormalized(categoryProducts.map((p) => p.collection || ''));

    // Generic filters built from each product's free-form `attrs` (material,
    // size, etc.) — skip the color/цвет key since it already has its own
    // dedicated section above, skip logistics/import noise
    // (BLOCKED_ATTR_PATTERN), skip keys that are effectively unique-per-product,
    // and cap the total number of groups to the ones filled in on the most
    // products in the current view (MAX_ATTR_FILTER_GROUPS).
    const attrMap: Record<string, string[]> = {};
    for (const p of categoryProducts) {
      for (const [key, value] of normalizeAttrEntries(p.attrs || {})) {
        const trimmedKey = key.trim();
        if (DUPLICATE_ATTR_KEY_PATTERN.test(trimmedKey)) continue;
        if (BLOCKED_ATTR_PATTERN.test(trimmedKey)) continue;
        (attrMap[key] ||= []).push(value);
      }
    }
    const availableAttrs: Record<string, string[]> = {};
    Object.entries(attrMap)
      .map(([key, raw]) => ({ key, values: dedupeByNormalized(raw), coverage: raw.length }))
      .filter(({ values }) => values.length > 1 && values.length <= 25)
      .sort((a, b) => b.coverage - a.coverage)
      .slice(0, MAX_ATTR_FILTER_GROUPS)
      .forEach(({ key, values }) => {
        availableAttrs[key] = values;
      });

    // Per-option counts for the filter checkboxes below. Building these as a
    // single pass over categoryProducts (instead of each FilterRow doing its
    // own categoryProducts.filter(...).length) keeps rendering the filter
    // sidebar O(products + options) instead of O(products * options).
    const colorCounts = new Map<string, number>();
    const brandCounts = new Map<string, number>();
    const collectionCounts = new Map<string, number>();
    const attrValueCounts = new Map<string, Map<string, number>>();
    for (const p of categoryProducts) {
      const colorKey = normalizeValue(getProductColor(p));
      colorCounts.set(colorKey, (colorCounts.get(colorKey) || 0) + 1);

      const brand = (p.brand || '').trim();
      if (brand) brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);

      const collectionKey = normalizeValue(p.collection || '');
      collectionCounts.set(collectionKey, (collectionCounts.get(collectionKey) || 0) + 1);

      for (const [key, value] of normalizeAttrEntries(p.attrs || {})) {
        const trimmedKey = key.trim();
        if (DUPLICATE_ATTR_KEY_PATTERN.test(trimmedKey) || BLOCKED_ATTR_PATTERN.test(trimmedKey)) continue;
        const valueKey = normalizeValue(value);
        let valueMap = attrValueCounts.get(key);
        if (!valueMap) {
          valueMap = new Map<string, number>();
          attrValueCounts.set(key, valueMap);
        }
        valueMap.set(valueKey, (valueMap.get(valueKey) || 0) + 1);
      }
    }

    const bundle: CatalogDerived = {
      categoryProducts,
      availableColors,
      allCatalogBrands,
      availableCollections,
      availableAttrs,
      colorCounts,
      brandCounts,
      collectionCounts,
      attrValueCounts,
    };
    byCatKey.set(catKey, bundle);
    return bundle;
  }, [categories, catKey, isAllMode, selectedCatIds]);

  const {
    categoryProducts,
    availableColors,
    allCatalogBrands,
    availableCollections,
    availableAttrs,
    colorCounts,
    brandCounts,
    collectionCounts,
    attrValueCounts,
  } = derived;
  const allProductsCount = categories.reduce((sum, c) => sum + c.items.length, 0);

  const colorCountInCategory = (color: string) => colorCounts.get(normalizeValue(color)) || 0;
  const brandCountInCategory = (brand: string) => brandCounts.get(brand) || 0;
  const collectionCountInCategory = (collection: string) => collectionCounts.get(normalizeValue(collection)) || 0;
  const attrValueCountInCategory = (key: string, value: string) =>
    attrValueCounts.get(key)?.get(normalizeValue(value)) || 0;

  // "Поиск по фильтрам" narrows the option lists themselves (a category like
  // "Смесители для раковины" has a dozen groups), matching on the group title
  // too so typing "материал" reveals that whole group. ё/е are folded because
  // the catalog spells colours without ё ("Черный") while users type "чёрный".
  const fq = filterQuery.trim().toLowerCase().replace(/ё/g, 'е');
  const matchesFilterQuery = (...values: string[]) =>
    !fq || values.some((v) => v.toLowerCase().replace(/ё/g, 'е').includes(fq));

  const visibleCategories = categories.filter((c) => matchesFilterQuery(c.title, 'категория'));
  const visibleBrands = allCatalogBrands.filter((b) => matchesFilterQuery(b, 'бренд'));
  const visibleCollections = availableCollections.filter((c) => matchesFilterQuery(c, 'коллекция'));
  const visibleColors = availableColors.filter((c) => matchesFilterQuery(c, 'цвет'));
  const visibleAttrs: Record<string, string[]> = Object.fromEntries(
    Object.entries<string[]>(availableAttrs)
      .map(([key, values]) => [
        key,
        matchesFilterQuery(key) ? values : values.filter((v) => matchesFilterQuery(v)),
      ] as const)
      .filter(([, values]) => values.length > 0)
  );
  const hasAnyVisibleFilter =
    visibleCategories.length > 0 ||
    visibleBrands.length > 0 ||
    visibleCollections.length > 1 ||
    visibleColors.length > 0 ||
    Object.keys(visibleAttrs).length > 0;

  const toggleColor = (color: string) => {
    setSelectedColors((prev) => (prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]));
  };

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) => (prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]));
  };

  // Clicking a brand that has nothing in the current category is only useful if
  // it takes the user somewhere it does exist — switch to all-categories and
  // apply just that brand.
  const selectBrandAcrossCatalog = (brand: string) => {
    // Only arm the skip when the category actually changes, otherwise the flag
    // would linger and swallow the reset on the next, unrelated switch.
    if (selectedCatIds.length > 0) skipFilterResetRef.current = true;
    setSelectedCatIds([]);
    setSelectedColors([]);
    setSelectedCollections([]);
    setSelectedAttrs({});
    setInStockOnly(false);
    setSelectedBrands([brand]);
  };

  const toggleCollection = (collection: string) => {
    setSelectedCollections((prev) => (prev.includes(collection) ? prev.filter((c) => c !== collection) : [...prev, collection]));
  };

  const toggleSubcategory = (subcategory: string) => {
    setSelectedSubcategories((prev) => (prev.includes(subcategory) ? prev.filter((s) => s !== subcategory) : [...prev, subcategory]));
  };

  const toggleAttrValue = (key: string, value: string) => {
    setSelectedAttrs((prev) => {
      const current = prev[key] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      const updated = { ...prev, [key]: next };
      if (next.length === 0) delete updated[key];
      return updated;
    });
  };

  // A group starts open only if it already has an active selection — keeps
  // the sidebar short by default but self-reveals whatever is filtering.
  // While a filter search is active every group is forced open, otherwise the
  // matches would stay hidden behind collapsed headers.
  const isGroupOpen = (key: string, hasSelection: boolean) =>
    fq ? true : openFilterGroups[key] ?? hasSelection;
  const toggleGroup = (key: string, hasSelection: boolean) => {
    setOpenFilterGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? hasSelection) }));
  };

  const attrFilterCount = Object.keys(selectedAttrs).reduce((sum, key) => sum + (selectedAttrs[key]?.length || 0), 0);
  const activeFilterCount = selectedColors.length + selectedBrands.length + selectedCollections.length + selectedSubcategories.length + attrFilterCount + (inStockOnly ? 1 : 0);

  const clearAllFilters = () => {
    setSelectedColors([]);
    setSelectedBrands([]);
    setSelectedCollections([]);
    setSelectedSubcategories([]);
    setSelectedAttrs({});
    setInStockOnly(false);
    setSearchQuery('');
  };

  const filteredProducts = useMemo(
    () =>
      categoryProducts
        .filter((p) => {
          if (q) {
            const matchesQuery =
              p.name.toLowerCase().includes(q) ||
              (p.brand || '').toLowerCase().includes(q) ||
              (p.collection || '').toLowerCase().includes(q) ||
              (p.sku || '').toLowerCase().includes(q);
            if (!matchesQuery) return false;
          }
          if (selectedColors.length > 0 && !selectedColors.some((c) => normalizeValue(c) === normalizeValue(getProductColor(p)))) return false;
          if (selectedBrands.length > 0 && !selectedBrands.includes((p.brand || '').trim())) return false;
          if (selectedCollections.length > 0 && !selectedCollections.some((c) => normalizeValue(c) === normalizeValue(p.collection || ''))) return false;
          if (selectedSubcategories.length > 0 && !selectedSubcategories.some((s) => normalizeValue(s) === normalizeValue(p.subcategory || ''))) return false;
          for (const key of Object.keys(selectedAttrs)) {
            const values = selectedAttrs[key];
            if (!values || values.length === 0) continue;
            if (!values.some((v) => normalizeValue(v) === normalizeValue(String(p.attrs?.[key] ?? '')))) return false;
          }
          if (inStockOnly && !p.inStock) return false;
          return true;
        })
        .sort((a, b) => {
          if (sortBy === 'stock') return Number(b.inStock) - Number(a.inStock);
          if (sortBy === 'price-asc') return (a.prices.retail || Infinity) - (b.prices.retail || Infinity);
          if (sortBy === 'price-desc') return (b.prices.retail || 0) - (a.prices.retail || 0);
          if (sortBy === 'name') return a.name.localeCompare(b.name, 'ru');
          return 0;
        }),
    [
      categoryProducts,
      q,
      selectedColors,
      selectedBrands,
      selectedCollections,
      selectedSubcategories,
      selectedAttrs,
      inStockOnly,
      sortBy,
    ]
  );

  // Any change to what's being shown starts the list over from the first page.
  const resultKey = `${catKey}|${q}|${sortBy}|${activeFilterCount}|${filteredProducts.length}`;
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [resultKey]);

  useEffect(() => {
    const categoryTitle = formatSeoValue(isAllMode ? 'Все категории' : (activeCategory?.title || 'Каталог товаров'));

    // Only a single-category view is a canonical page; multi-category picks are
    // just filter combinations and shouldn't each claim their own canonical.
    const categoryUrl = activeCategory
      ? `https://bathroomdesign.kz/catalog?cat=${encodeURIComponent(activeCategory.id)}`
      : 'https://bathroomdesign.kz/catalog';
    return applySeo({
      title: formatSeoValue(activeCategory?.seoTitle) || `${categoryTitle} | Каталог Bathroom Design`,
      description: formatSeoValue(activeCategory?.seoDescription) ||
        (isAllMode
          ? `Каталог Bathroom Design: ${filteredProducts.length} товаров.`
          : `Каталог Bathroom Design: ${filteredProducts.length} товаров в категории ${categoryTitle}.`),
      keywords: formatSeoValue(activeCategory?.seoKeywords) || [categoryTitle, 'сантехника', 'ванная комната'].join(', '),
      canonicalUrl: categoryUrl,
      ogUrl: categoryUrl,
      ogType: 'website',
      twitterCard: 'summary_large_image',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, isAllMode, catKey, filteredProducts.length]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  // Sorting by price is meaningless while the whole catalog is priced on
  // request — the options come back on their own if prices are re-imported.
  const hasAnyPrice = categoryProducts.some((p) => p.prices?.retail);

  return (
    <div>
      <CategoryHero
        title={isAllMode ? 'Все товары' : (activeCategory?.title || 'Все товары')}
        count={filteredProducts.length}
      />

      <div className="container mx-auto px-6 py-12">
      <nav aria-label="Хлебные крошки" className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <Link to="/" className="transition-colors hover:text-[#CEA549]">Главная</Link>
        <span>/</span>
        {isAllMode ? (
          <span className="font-semibold text-[#1D2B49]">Каталог</span>
        ) : (
          <>
            <Link to="/catalog?cat=all" className="transition-colors hover:text-[#CEA549]">Каталог</Link>
            <span>/</span>
            <span className="font-semibold text-[#1D2B49]">
              {activeCategory ? activeCategory.title : 'Выбранные категории'}
            </span>
          </>
        )}
      </nav>

      {/* Categories as a horizontal tab strip — they're navigation, not a
          filter, and in the sidebar they used to push the actual filters
          below the fold and force a nested scrollbar. */}
      <div className="-mx-6 px-6 mb-8 overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-2 min-w-max pb-1">
          <button
            onClick={() => selectCategory('all')}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all ${
              isAllMode
                ? 'bg-[#1D2B49] text-white shadow-md'
                : 'bg-white text-[#1D2B49] border border-gray-200 hover:border-[#CEA549]'
            }`}
          >
            Все категории
            <span className={`text-[10px] font-bold ${isAllMode ? 'text-white/60' : 'text-gray-400'}`}>
              {allProductsCount}
            </span>
          </button>
          {categories.map((cat) => {
            const isActive = selectedCatIds.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => selectCategory(cat.id)}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-[#1D2B49] text-white shadow-md'
                    : 'bg-white text-[#1D2B49] border border-gray-200 hover:border-[#CEA549]'
                }`}
              >
                {cat.title}
                <span className={`text-[10px] font-bold ${isActive ? 'text-white/60' : 'text-gray-400'}`}>
                  {cat.items.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar — a static column on desktop, a bottom sheet on phones (an
            inline panel pushed the products themselves off the first screen). */}
        <aside className="flex-shrink-0 lg:w-64">
          <div
            className={
              filtersOpen
                ? 'fixed inset-0 z-[70] bg-black/50 lg:static lg:z-auto lg:bg-transparent'
                : `hidden lg:block ${sidebarSticky ? 'lg:sticky lg:top-32' : ''}`
            }
            onClick={(e) => {
              if (e.target === e.currentTarget) setFiltersOpen(false);
            }}
          >
            <div
              ref={sidebarRef}
              data-lenis-prevent
              className={`bg-white border border-gray-100 px-5 py-2 ${
                filtersOpen
                  ? 'absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-3xl pb-24 lg:static lg:max-h-none lg:overflow-visible lg:rounded-3xl lg:pb-2'
                  : 'rounded-3xl'
              }`}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-100 bg-white py-3 lg:static">
                <h2 className="font-heading font-semibold text-[#1D2B49]">Фильтры</h2>
                <div className="flex items-center gap-3">
                  {activeFilterCount > 0 ? (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="whitespace-nowrap text-xs font-semibold text-gray-400 transition-colors hover:text-[#CEA549]"
                    >
                      Сбросить ({activeFilterCount})
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    aria-label="Закрыть фильтры"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 lg:hidden"
                  >
                    <i className="fas fa-xmark"></i>
                  </button>
                </div>
              </div>

              <div className="relative py-3 border-b border-gray-100">
                <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Поиск по фильтрам"
                  className="w-full bg-gray-50 border border-transparent rounded-xl pl-8 pr-8 py-2 text-sm outline-none focus:bg-white focus:border-[#CEA549] transition-all"
                />
                {filterQuery ? (
                  <button
                    type="button"
                    onClick={() => setFilterQuery('')}
                    aria-label="Очистить"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-[#1D2B49] text-xs"
                  >
                    <i className="fas fa-xmark"></i>
                  </button>
                ) : null}
              </div>

              {visibleCategories.length > 0 ? (
                <FilterGroup
                  title="Категория"
                  count={selectedCatIds.length}
                  open={isGroupOpen('category', true)}
                  onToggle={() => toggleGroup('category', true)}
                >
                  {visibleCategories.map((cat) => {
                    const isChecked = selectedCatIds.includes(cat.id);
                    // Subcategories only make sense scoped to one open category -
                    // shown nested right under it once it's checked, not as a
                    // separate flat group sitting next to "Категория".
                    const subcats = isChecked
                      ? dedupeByNormalized(cat.items.map((p) => p.subcategory || '')).filter((s) => matchesFilterQuery(s, 'подкатегория'))
                      : [];
                    return (
                      <React.Fragment key={cat.id}>
                        <FilterRow
                          label={cat.title}
                          count={cat.items.length}
                          checked={isChecked}
                          onChange={() => toggleCategory(cat.id)}
                        />
                        {subcats.length > 1 ? (
                          <div className="ml-4 space-y-0.5 border-l-2 border-gray-100 pl-3">
                            {subcats.map((subcategory) => (
                              <FilterRow
                                key={subcategory}
                                label={subcategory}
                                count={cat.items.filter((p) => normalizeValue(p.subcategory || '') === normalizeValue(subcategory)).length}
                                checked={selectedSubcategories.includes(subcategory)}
                                onChange={() => toggleSubcategory(subcategory)}
                              />
                            ))}
                          </div>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </FilterGroup>
              ) : null}

            {visibleBrands.length > 0 ? (
              <FilterGroup
                title="Бренд"
                count={selectedBrands.length}
                open={isGroupOpen('brand', true)}
                onToggle={() => toggleGroup('brand', true)}
              >
                {visibleBrands.map((brand) => {
                  const count = brandCountInCategory(brand);
                  const absentHere = count === 0;
                  return (
                    <FilterRow
                      key={brand}
                      label={brand}
                      count={count}
                      muted={absentHere}
                      title={absentHere ? `${brand} нет в этой категории — показать по всему каталогу` : undefined}
                      checked={selectedBrands.includes(brand)}
                      onChange={() => (absentHere ? selectBrandAcrossCatalog(brand) : toggleBrand(brand))}
                    />
                  );
                })}
              </FilterGroup>
            ) : null}

            {(fq ? visibleCollections.length > 0 : visibleCollections.length > 1) ? (
              <FilterGroup
                title="Коллекция"
                count={selectedCollections.length}
                open={isGroupOpen('collection', selectedCollections.length > 0)}
                onToggle={() => toggleGroup('collection', selectedCollections.length > 0)}
              >
                {visibleCollections.map((collection) => (
                  <FilterRow
                    key={collection}
                    label={collection}
                    count={collectionCountInCategory(collection)}
                    checked={selectedCollections.includes(collection)}
                    onChange={() => toggleCollection(collection)}
                  />
                ))}
              </FilterGroup>
            ) : null}

            {visibleColors.length > 0 ? (
              <FilterGroup
                title="Цвет"
                count={selectedColors.length}
                open={isGroupOpen('color', selectedColors.length > 0)}
                onToggle={() => toggleGroup('color', selectedColors.length > 0)}
              >
                {visibleColors.map((color) => (
                  <FilterRow
                    key={color}
                    label={color}
                    count={colorCountInCategory(color)}
                    checked={selectedColors.includes(color)}
                    onChange={() => toggleColor(color)}
                  />
                ))}
              </FilterGroup>
            ) : null}

            {Object.entries(visibleAttrs).map(([key, values]) => {
              const selectedCount = (selectedAttrs[key] || []).length;
              return (
                <FilterGroup
                  key={key}
                  title={key}
                  count={selectedCount}
                  open={isGroupOpen(`attr:${key}`, selectedCount > 0)}
                  onToggle={() => toggleGroup(`attr:${key}`, selectedCount > 0)}
                >
                  {values.map((value) => (
                    <FilterRow
                      key={value}
                      label={value}
                      count={attrValueCountInCategory(key, value)}
                      checked={(selectedAttrs[key] || []).includes(value)}
                      onChange={() => toggleAttrValue(key, value)}
                    />
                  ))}
                </FilterGroup>
              );
            })}

              {fq && !hasAnyVisibleFilter ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  По запросу «{filterQuery.trim()}» фильтров не найдено
                </p>
              ) : null}

              {!fq ? (
                <div className="py-3">
                  <FilterRow
                    label="Только в наличии"
                    checked={inStockOnly}
                    onChange={() => setInStockOnly((v) => !v)}
                  />
                </div>
              ) : null}

              {filtersOpen ? (
                <div className="sticky bottom-0 -mx-5 border-t border-gray-100 bg-white px-5 py-3 lg:hidden">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="w-full rounded-full bg-[#1D2B49] py-3.5 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
                  >
                    Показать {filteredProducts.length} товаров
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="flex-grow">
          <div className="mb-6 flex gap-3">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-3 font-heading text-sm font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549] lg:hidden"
            >
              <i className="fas fa-sliders"></i>
              Фильтры
              {activeFilterCount > 0 ? (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#CEA549] px-1.5 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>

            {/* The header search is always on screen, so the phone layout doesn't
                need a second search field competing with it. */}
            <div className="relative hidden flex-grow md:block">
              <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                placeholder="Поиск в этой категории..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full max-w-md rounded-full border border-gray-200 bg-white py-3 pl-12 pr-4 outline-none transition-all focus:border-[#CEA549] focus:ring-4 focus:ring-[#CEA549]/10"
              />
            </div>

            <div className="relative w-full md:w-64">
              <i className="fas fa-arrow-down-wide-short absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"></i>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="w-full appearance-none bg-white border border-gray-200 rounded-full pl-12 pr-10 py-3 font-semibold text-sm text-[#1D2B49] focus:border-[#CEA549] focus:ring-4 focus:ring-[#CEA549]/10 outline-none transition-all cursor-pointer"
              >
                <option value="default">По умолчанию</option>
                <option value="stock">Сначала в наличии</option>
                {hasAnyPrice ? <option value="price-asc">Сначала дешевле</option> : null}
                {hasAnyPrice ? <option value="price-desc">Сначала дороже</option> : null}
                <option value="name">По названию</option>
              </select>
              <i className="fas fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none"></i>
            </div>
          </div>

          {(selectedBrands.length > 0 || selectedCollections.length > 0 || selectedSubcategories.length > 0 || selectedColors.length > 0 || attrFilterCount > 0 || inStockOnly) ? (
            <div className="flex flex-wrap gap-2 mb-6">
              {Object.keys(selectedAttrs).flatMap((key) =>
                (selectedAttrs[key] || []).map((value) => (
                  <button
                    key={`attr-${key}-${value}`}
                    onClick={() => toggleAttrValue(key, value)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1D2B49] text-white text-xs font-bold"
                  >
                    {key}: {value}
                    <i className="fas fa-xmark"></i>
                  </button>
                ))
              )}
              {selectedBrands.map((brand) => (
                <button
                  key={`b-${brand}`}
                  onClick={() => toggleBrand(brand)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1D2B49] text-white text-xs font-bold"
                >
                  {brand}
                  <i className="fas fa-xmark"></i>
                </button>
              ))}
              {selectedCollections.map((collection) => (
                <button
                  key={`c-${collection}`}
                  onClick={() => toggleCollection(collection)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1D2B49] text-white text-xs font-bold"
                >
                  {collection}
                  <i className="fas fa-xmark"></i>
                </button>
              ))}
              {selectedSubcategories.map((subcategory) => (
                <button
                  key={`sub-${subcategory}`}
                  onClick={() => toggleSubcategory(subcategory)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1D2B49] text-white text-xs font-bold"
                >
                  {subcategory}
                  <i className="fas fa-xmark"></i>
                </button>
              ))}
              {selectedColors.map((color) => (
                <button
                  key={`col-${color}`}
                  onClick={() => toggleColor(color)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1D2B49] text-white text-xs font-bold"
                >
                  {color}
                  <i className="fas fa-xmark"></i>
                </button>
              ))}
              {inStockOnly ? (
                <button
                  onClick={() => setInStockOnly(false)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1D2B49] text-white text-xs font-bold"
                >
                  Только в наличии
                  <i className="fas fa-xmark"></i>
                </button>
              ) : null}
            </div>
          ) : null}

          {catalogStatus === 'loading' ? (
            <ProductGridSkeleton count={6} />
          ) : catalogStatus === 'error' ? (
            <CatalogError onRetry={onRetryCatalog} />
          ) : filteredProducts.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {visibleProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
                ))}
              </div>

              {visibleCount < filteredProducts.length ? (
                <div className="mt-10 flex flex-col items-center gap-3">
                  <div className="text-sm text-gray-400">
                    Показано {visibleProducts.length} из {filteredProducts.length}
                  </div>
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-8 py-3.5 font-heading font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549] hover:shadow-md"
                  >
                    Показать ещё
                    <i className="fas fa-arrow-down text-xs"></i>
                  </button>
                </div>
              ) : (
                <div className="mt-10 text-center text-sm text-gray-400">
                  Показаны все {filteredProducts.length} товаров
                </div>
              )}
            </>
          ) : (
            <div className="rounded-3xl border-2 border-dashed border-gray-200 bg-white p-12 text-center sm:p-20">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gray-50 text-3xl text-gray-300">
                <i className="fas fa-box-open"></i>
              </div>
              <h3 className="font-heading text-2xl font-semibold text-gray-400">Товары не найдены</h3>
              <p className="mt-2 text-gray-400">Попробуйте изменить параметры поиска или категорию</p>
              {activeFilterCount > 0 || q ? (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mt-6 inline-flex rounded-full bg-[#1D2B49] px-7 py-3 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
                >
                  Сбросить фильтры
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default CatalogPage;
