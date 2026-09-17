import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Category, Product } from '../types';
import { displayPrice, getProductImages, productPath } from '../utils/product';

const MAX_SUGGESTIONS = 6;

interface SearchBoxProps {
  categories: Category[];
  /** Light styling for the transparent header floating over the hero photo. */
  onDark?: boolean;
  /** Called after a suggestion is picked — lets the mobile menu close itself. */
  onNavigate?: () => void;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Catalog-wide search with live suggestions. The whole catalog is already in
 * memory (App fetches it once), so matching happens client-side — no request
 * per keystroke.
 */
const SearchBox: React.FC<SearchBoxProps> = ({ categories, onDark, onNavigate, autoFocus, className = '' }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const allProducts = useMemo(() => categories.flatMap((c) => c.items || []), [categories]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [] as Product[];
    const scored: { product: Product; score: number }[] = [];
    for (const p of allProducts) {
      const name = p.name.toLowerCase();
      const haystack = `${name} ${(p.brand || '').toLowerCase()} ${(p.collection || '').toLowerCase()} ${(p.sku || '').toLowerCase()}`;
      if (!haystack.includes(q)) continue;
      // Name matches first, and matches at the start of the name above those.
      const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
      scored.push({ product: p, score });
      if (scored.length > 200) break;
    }
    return scored
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((s) => s.product);
  }, [query, allProducts]);

  const totalMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return 0;
    return allProducts.filter((p) =>
      `${p.name} ${p.brand || ''} ${p.collection || ''} ${p.sku || ''}`.toLowerCase().includes(q)
    ).length;
  }, [query, allProducts]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Close the dropdown when the click lands anywhere else on the page.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const goToProduct = (product: Product) => {
    setQuery('');
    close();
    onNavigate?.();
    navigate(productPath(product));
  };

  const goToResults = () => {
    const q = query.trim();
    if (!q) return;
    close();
    onNavigate?.();
    navigate(`/catalog?cat=all&q=${encodeURIComponent(q)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) goToProduct(suggestions[activeIndex]);
      else goToResults();
    }
  };

  const showDropdown = isOpen && query.trim().length >= 2;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <i
          className={`fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm ${
            onDark ? 'text-white/70' : 'text-gray-400'
          }`}
        ></i>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-label="Поиск по каталогу"
          value={query}
          placeholder="Поиск: смеситель, Allen Brau, артикул…"
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          className={`w-full rounded-full py-2.5 pl-11 pr-10 text-sm outline-none transition-all ${
            onDark
              ? 'border border-white/30 bg-white/15 text-white placeholder:text-white/60 focus:border-white/60 focus:bg-white/25'
              : 'border border-gray-200 bg-gray-50 text-[#1D2B49] placeholder:text-gray-400 focus:border-[#CEA549] focus:bg-white focus:ring-4 focus:ring-[#CEA549]/10'
          }`}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Очистить поиск"
            className={`absolute right-4 top-1/2 -translate-y-1/2 text-sm ${
              onDark ? 'text-white/70 hover:text-white' : 'text-gray-300 hover:text-[#1D2B49]'
            }`}
          >
            <i className="fas fa-xmark"></i>
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
          {suggestions.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-gray-400">
              Ничего не нашлось по запросу «{query.trim()}»
            </div>
          ) : (
            <>
              <ul role="listbox">
                {suggestions.map((p, idx) => {
                  const image = getProductImages(p)[0];
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={idx === activeIndex}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => goToProduct(p)}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          idx === activeIndex ? 'bg-gray-50' : ''
                        }`}
                      >
                        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-gray-50">
                          {image ? (
                            <img src={image} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-gray-300">
                              <i className="fas fa-bath"></i>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-grow">
                          <div className="truncate text-sm font-semibold text-[#1D2B49]">{p.name}</div>
                          <div className="truncate text-xs text-gray-400">
                            {[p.brand, p.sku].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-sm font-semibold text-[#1D2B49]">{displayPrice(p)}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={goToResults}
                className="w-full border-t border-gray-100 bg-gray-50 px-5 py-3 text-sm font-semibold text-[#1D2B49] transition-colors hover:bg-gray-100"
              >
                Показать все результаты ({totalMatches})
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default SearchBox;
