import React, { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CatalogStatus, Category } from '../types';
import { ProductGridSkeleton } from '../components/CatalogState';
import NotFoundPage from './NotFoundPage';

interface CategoryRouteProps {
  categories: Category[];
  catalogStatus: CatalogStatus;
}

/**
 * `/catalog/<slug>` — the canonical, indexable address of a category.
 *
 * Categories were previously addressed only as `/catalog?cat=<cyrillic id>`,
 * which percent-encodes into unreadable URLs. This route is what the sitemap
 * lists, what internal links point at, and what every canonical tag for a
 * single-category view declares — and the server renders the full category
 * page here for crawlers (backend services/seoRender.js).
 *
 * For users with JS, it hands off to the existing CatalogPage by its
 * `?cat=` query form. That is deliberate: CatalogPage's URL state machine
 * supports multi-select categories plus a dozen other filters and carries two
 * documented infinite-loop hazards (see its `isSyncingCatFromUrlRef` and
 * `skipFilterResetRef`). Teaching it to also own a path segment would risk a
 * repeat of the filter-loss regression fixed in 50ae947 for a marginal SEO
 * gain, since crawlers already receive the clean URL with correct content.
 */
const CategoryRoute: React.FC<CategoryRouteProps> = ({ categories, catalogStatus }) => {
  const { slug = '' } = useParams();

  const category = useMemo(
    () => categories.find((c) => c.slug === slug),
    [categories, slug]
  );

  // A missing category means "catalog hasn't arrived yet" until it has.
  if (catalogStatus === 'loading' || (categories.length === 0 && catalogStatus !== 'error')) {
    return (
      <div className="container mx-auto px-6 py-16">
        <ProductGridSkeleton />
      </div>
    );
  }

  if (!category) return <NotFoundPage />;

  return <Navigate to={`/catalog?cat=${encodeURIComponent(category.id)}`} replace />;
};

export default CategoryRoute;
