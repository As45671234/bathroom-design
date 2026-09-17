import React, { useEffect, useRef, useState } from 'react';
import { Product } from '../types';
import { VisualSearchComponent } from '../services/api';
import Reveal from '../components/Reveal';
import ProductCard from '../components/ProductCard';

interface VisualSearchPageProps {
  onAddToCart: (p: Product) => void;
  // Owned by App (see App.tsx) rather than local state, so the photo and its
  // results survive navigating to a product and back — this page unmounts
  // on every route change like any other route.
  preview: string;
  loading: boolean;
  error: string;
  results: VisualSearchComponent[] | null;
  onFileSelected: (file: File | null) => void;
}

const matchToProduct = (m: VisualSearchComponent['matches'][number]): Product => ({
  id: m.id,
  name: m.name,
  brand: m.brand,
  collection: m.collection,
  unit: 'шт',
  sku: m.sku,
  image: m.image,
  images: m.images,
  prices: m.prices,
  attrs: m.attrs,
  category_id: m.category_id,
  inStock: true,
});

// The request runs several seconds; naming each step makes the wait feel like
// progress instead of a hang.
const SEARCH_STEPS = [
  { icon: 'fa-image', text: 'Обрабатываем фото' },
  { icon: 'fa-wand-magic-sparkles', text: 'Распознаём сантехнику на снимке' },
  { icon: 'fa-magnifying-glass', text: 'Ищем похожие товары в каталоге' },
];

const VisualSearchPage: React.FC<VisualSearchPageProps> = ({
  onAddToCart,
  preview,
  loading,
  error,
  results,
  onFileSelected,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState(0);

  // Steps advance on a timer rather than from real progress — the API is a
  // single call with no intermediate events to report.
  useEffect(() => {
    if (!loading) {
      setStep(0);
      return;
    }
    const timer = window.setInterval(() => {
      setStep((s) => Math.min(s + 1, SEARCH_STEPS.length - 1));
    }, 1600);
    return () => window.clearInterval(timer);
  }, [loading]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (loading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  // Lets a user paste a screenshot/copied image straight from the clipboard
  // (Ctrl+V / Cmd+V) anywhere on the page, not just when the drop zone is focused.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      onFileSelected(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onFileSelected]);

  return (
    <div className="container mx-auto px-6 py-12">
      <div className="max-w-2xl mx-auto text-center mb-10">
        <div className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Поиск по картинке</div>
        <h1 className="text-3xl md:text-4xl font-heading font-semibold text-[#1D2B49]">
          Подбор по фото
        </h1>
        <p className="mt-4 text-gray-500">
          Загрузите фото ванной комнаты или отдельного элемента — мы найдём похожие товары в нашем каталоге.
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => !loading && inputRef.current?.click()}
          className={`relative overflow-hidden rounded-3xl border-2 border-dashed bg-white transition-all ${
            loading ? 'cursor-default border-[#CEA549]' : 'cursor-pointer border-gray-200 hover:border-[#CEA549]'
          }`}
        >
          {preview ? (
            <img src={preview} alt="" className="w-full max-h-96 object-contain bg-gray-50" />
          ) : (
            <div className="py-20 flex flex-col items-center px-6 text-center text-gray-400">
              <i className="fas fa-camera text-4xl mb-4"></i>
              <p className="font-semibold text-gray-500">Нажмите, перетащите фото или вставьте из буфера</p>
              <p className="text-sm mt-1">JPG, PNG или WEBP, до 10 МБ · Ctrl+V</p>
            </div>
          )}

          {/* Scanning overlay — only while the AI is actually reading this photo. */}
          {loading && preview ? (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[#1D2B49]/25" />
              <div className="vs-scan absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-[#CEA549]/70 to-transparent" />
              <div className="vs-corner absolute left-4 top-4 h-7 w-7 border-l-2 border-t-2 border-[#CEA549]" />
              <div className="vs-corner absolute right-4 top-4 h-7 w-7 border-r-2 border-t-2 border-[#CEA549]" />
              <div className="vs-corner absolute bottom-4 left-4 h-7 w-7 border-b-2 border-l-2 border-[#CEA549]" />
              <div className="vs-corner absolute bottom-4 right-4 h-7 w-7 border-b-2 border-r-2 border-[#CEA549]" />
            </div>
          ) : null}

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
          />
        </div>

        {preview && !loading ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-gray-200 bg-white font-heading font-semibold text-sm text-[#1D2B49] hover:border-[#CEA549] transition-all"
          >
            <i className="fas fa-rotate"></i>
            Загрузить другое фото
          </button>
        ) : null}

        {loading ? (
          <ol className="mt-6 space-y-3">
            {SEARCH_STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <li
                  key={s.text}
                  className={`flex items-center gap-3 text-sm transition-all duration-500 ${
                    active ? 'text-[#1D2B49] font-semibold' : done ? 'text-gray-400' : 'text-gray-300'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all duration-500 ${
                      active ? 'bg-[#CEA549] text-white' : done ? 'bg-emerald-50 text-emerald-500' : 'bg-gray-100 text-gray-300'
                    }`}
                  >
                    {done ? (
                      <i className="fas fa-check text-xs"></i>
                    ) : active ? (
                      <i className="fas fa-circle-notch fa-spin text-xs"></i>
                    ) : (
                      <i className={`fas ${s.icon} text-xs`}></i>
                    )}
                  </span>
                  {s.text}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {/* Skeleton results so the page keeps its shape while the answer lands. */}
      {loading ? (
        <div className="mt-14">
          <div className="mb-6 h-5 w-48 animate-pulse rounded bg-gray-100" />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse overflow-hidden rounded-3xl border border-gray-100 bg-white"
                style={{ animationDelay: `${i * 150}ms` }}
              >
                <div className="aspect-square bg-gray-100" />
                <div className="space-y-3 p-5">
                  <div className="h-3 w-1/3 rounded bg-gray-100" />
                  <div className="h-3 w-5/6 rounded bg-gray-100" />
                  <div className="h-3 w-2/3 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="max-w-2xl mx-auto mt-8 bg-red-50 text-red-600 rounded-2xl p-6 text-center font-semibold">
          {error}
        </div>
      ) : null}

      {results ? (
        results.length === 0 ? (
          <div className="max-w-2xl mx-auto mt-8 bg-white rounded-3xl p-16 text-center border-2 border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-300 text-3xl">
              <i className="fas fa-magnifying-glass"></i>
            </div>
            <h3 className="text-xl font-heading font-semibold text-gray-400">
              Не удалось распознать компоненты на фото
            </h3>
            <p className="text-gray-400 mt-2">Попробуйте другое фото с более чётким видом сантехники</p>
          </div>
        ) : (
          <div className="mt-14">
            <div className="mb-8 text-xs font-black uppercase tracking-[0.2em] text-gray-400">
              Нашли на фото: {results.length}{' '}
              {results.length === 1 ? 'элемент' : results.length < 5 ? 'элемента' : 'элементов'}
            </div>

            <div className="space-y-12">
              {results.map((component, i) => (
                <Reveal key={i} index={i}>
                  <div className={i > 0 ? 'border-t border-gray-100 pt-12' : ''}>
                    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-xl sm:text-2xl font-heading font-semibold text-[#1D2B49] first-letter:uppercase">
                        {component.type}
                      </h2>
                      {component.matches.length > 0 ? (
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">
                          {component.matches.length}
                        </span>
                      ) : null}
                      {component.description ? (
                        <p className="w-full text-sm text-gray-500">{component.description}</p>
                      ) : null}
                    </div>

                    {component.matches.length === 0 ? (
                      <p className="rounded-2xl bg-gray-50 px-5 py-4 text-sm text-gray-400">
                        В каталоге не нашлось похожих товаров
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                        {component.matches.map((m) => (
                          <ProductCard key={m.id} product={matchToProduct(m)} onAddToCart={onAddToCart} />
                        ))}
                      </div>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
};

export default VisualSearchPage;
