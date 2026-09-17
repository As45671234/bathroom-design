import React from 'react';

/** Grey placeholder cards shown while the one-shot catalog request is in flight. */
export const ProductGridSkeleton: React.FC<{ count?: number; className?: string }> = ({
  count = 8,
  className = 'grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3',
}) => (
  <div className={className} aria-hidden="true">
    {Array.from({ length: count }).map((_, idx) => (
      <div key={idx} className="animate-pulse overflow-hidden rounded-3xl border border-gray-100 bg-white">
        <div className="h-56 bg-gray-100" />
        <div className="space-y-3 p-5">
          <div className="h-4 w-4/5 rounded bg-gray-100" />
          <div className="h-3 w-1/3 rounded bg-gray-100" />
          <div className="flex items-center justify-between pt-4">
            <div className="h-6 w-24 rounded bg-gray-100" />
            <div className="h-10 w-28 rounded-full bg-gray-100" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

interface CatalogErrorProps {
  onRetry?: () => void;
  /** Kept short on the homepage, where the block sits between other sections. */
  compact?: boolean;
}

/**
 * Shown when the catalog request failed. Deliberately distinct from the
 * "ничего не найдено" empty state — a network error isn't the user's search
 * being too narrow, and telling them to change the filters is misleading.
 */
export const CatalogError: React.FC<CatalogErrorProps> = ({ onRetry, compact }) => (
  <div
    className={`rounded-3xl border border-gray-100 bg-white text-center ${compact ? 'p-10' : 'p-12 sm:p-16'}`}
    role="alert"
  >
    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-2xl text-orange-500">
      <i className="fas fa-plug-circle-exclamation"></i>
    </div>
    <h3 className="font-heading text-xl font-semibold text-[#1D2B49]">Не удалось загрузить каталог</h3>
    <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
      Проверьте соединение с интернетом — товары появятся сразу после повторной попытки.
    </p>
    {onRetry ? (
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#1D2B49] px-7 py-3 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
      >
        <i className="fas fa-rotate-right text-xs"></i>
        Попробовать снова
      </button>
    ) : null}
  </div>
);
