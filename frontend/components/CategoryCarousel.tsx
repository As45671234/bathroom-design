import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { prefersReducedMotion } from '../hooks/useLenis';

export interface CategorySlide {
  id: string;
  title: string;
  image: string;
  count: number;
}

interface CategoryCarouselProps {
  items: CategorySlide[];
}

const AUTOPLAY_MS = 3500;
const GAP_PX = 10;

/**
 * Distance from the start of the first copy to the start of the second — i.e.
 * the exact offset that makes the wrap invisible. Measured from the clones'
 * layout positions rather than `scrollWidth / 2`, which would also count the
 * scroller's horizontal padding (charged once, not once per copy) and drift a
 * few px on every loop.
 */
const copyWidth = (el: HTMLElement, count: number): number => {
  const first = el.children[0];
  const seam = el.children[count];
  if (!first || !seam) return 0;
  // getBoundingClientRect, not offsetLeft: offsetLeft rounds to whole pixels,
  // and the leftover fraction compounds into visible drift after a few loops.
  return seam.getBoundingClientRect().left - first.getBoundingClientRect().left;
};

/**
 * Auto-scrolling category strip. The slide list is rendered twice and the
 * scroll position is wrapped back by exactly one copy's width once it passes
 * the seam, so the loop never shows an end.
 *
 * Built on a native scroll container rather than a transform track so touch
 * swipe, trackpad panning and keyboard focus scrolling all come for free.
 */
const CategoryCarousel: React.FC<CategoryCarouselProps> = ({ items }) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  // Fraction of one copy that is scrolled past (0..1) and the fraction of it
  // that fits on screen — together they place the progress bar's thumb.
  const [progress, setProgress] = useState(0);
  const [thumb, setThumb] = useState(0.33);

  // Once the first slide of the second copy is flush left, that view is pixel
  // identical to the first slide of the first copy — so jumping back by one
  // copy right then is invisible. The tolerance absorbs the sub-pixel rounding
  // the browser applies to every scroll write.
  const loop = useCallback(
    (el: HTMLDivElement) => {
      const width = copyWidth(el, items.length);
      if (width > 0 && el.scrollLeft >= width - 0.5) {
        // Rewinding must be instant, or the browser animates back across every
        // slide and the seam becomes very visible.
        const behavior = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollLeft -= width;
        el.style.scrollBehavior = behavior;
      }
    },
    [items.length]
  );

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const width = copyWidth(el, items.length);
    if (width <= 0) return;
    loop(el);
    setProgress((el.scrollLeft % width) / width);
    setThumb(Math.min(1, el.clientWidth / width));
  }, [loop, items.length]);

  useEffect(() => {
    handleScroll();
    window.addEventListener('resize', handleScroll);
    return () => window.removeEventListener('resize', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (paused || prefersReducedMotion()) return;
    const timer = setInterval(() => {
      const el = scrollerRef.current;
      if (!el) return;
      // One slide = one cell plus the gap between cells.
      const cell = el.firstElementChild?.getBoundingClientRect().width;
      const step = cell ? cell + GAP_PX : el.clientWidth;
      if (step <= 0) return;
      loop(el);

      // Advance to an absolute multiple of `step` rather than scrollBy-ing a
      // relative amount: the browser quantises every scroll write to device
      // pixels, and over a long autoplay run those fractions would compound
      // until the slides sat visibly off-grid. Deriving the index from the
      // live scroll position also keeps autoplay in step after a manual swipe.
      const next = Math.round(el.scrollLeft / step) + 1;
      el.scrollTo({ left: next * step, behavior: 'smooth' });
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [paused, loop, items.length]);

  if (items.length === 0) return null;

  // Second copy is decorative: it duplicates links that are already reachable,
  // so it stays out of the a11y tree and out of the tab order.
  const slides = [
    ...items.map((item) => ({ item, clone: false })),
    ...items.map((item) => ({ item, clone: true })),
  ];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex gap-[10px] overflow-x-auto overflow-y-hidden px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map(({ item, clone }, idx) => (
          <Link
            key={`${item.id}-${idx}`}
            to={`/catalog?cat=${item.id}`}
            aria-hidden={clone || undefined}
            tabIndex={clone ? -1 : undefined}
            className="group relative block h-[400px] w-[86%] shrink-0 overflow-hidden bg-[#1D2B49] sm:h-[450px] sm:w-[calc((100%-10px)/2)] lg:h-[480px] lg:w-[calc((100%-20px)/3)]"
          >
            <img
              src={item.image}
              alt={item.title}
              loading={idx < 3 ? undefined : 'lazy'}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent transition-opacity duration-500 group-hover:from-black/85" />
            <div className="absolute inset-x-0 bottom-0 p-8">
              <h3 className="font-heading text-3xl font-bold leading-tight text-white transition-transform duration-500 ease-out group-hover:-translate-y-1">
                {item.title}
              </h3>
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white/0 transition-all duration-500 ease-out group-hover:text-white/85">
                Смотреть товары
                <i className="fas fa-arrow-right text-xs" aria-hidden="true"></i>
              </div>
              <div className="mt-1 text-xs uppercase tracking-widest text-white/55">{item.count} товаров</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Progress rail — the thumb walks the full width once per loop, and a
          second copy slides in from the left so the wrap has no visible gap. */}
      <div className="container mx-auto px-6">
        <div className="relative mt-8 h-px w-full overflow-hidden bg-gray-200" aria-hidden="true">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="absolute top-0 h-px bg-[#1D2B49]"
              style={{ left: `${(progress - copy) * 100}%`, width: `${thumb * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryCarousel;
