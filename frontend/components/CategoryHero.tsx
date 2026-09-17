
import React from 'react';
import Reveal from './Reveal';
import { getCategoryIcon } from '../utils/categoryIcon';

interface CategoryHeroProps {
  title: string;
  count: number;
}

/**
 * CategoryHero - full-bleed banner for the catalog page: one interior photo
 * behind a navy gradient that keeps the title readable. Deliberately does NOT
 * use the category's own `image` - that's a raw supplier catalog photo (any
 * aspect ratio, plain white background, never shot as a banner) and no crop
 * made it look intentional.
 *
 * Photo is Unsplash (free licence, commercial use OK) in public/assets/hero.
 */
const CategoryHero: React.FC<CategoryHeroProps> = ({ title, count }) => {
  const icon = getCategoryIcon(title);
  return (
    // Kept short on phones: a 320px banner pushed the first product card to ~860px
    // down the page, so the catalog opened on a photo instead of on products.
    <div className="relative h-[180px] overflow-hidden bg-[#1D2B49] sm:h-[260px] md:h-[300px]">
      <img
        src="/assets/hero/hero-bg.webp"
        alt=""
        aria-hidden="true"
        loading="eager"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {/* Navy wash over the photo - the title sits on the left, so the gradient is
          heaviest there and lets the interior read on the right. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#1D2B49]/85 via-[#1D2B49]/45 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0f1729]/65 to-transparent" />

      <div className="relative flex h-full items-end">
        <div className="container mx-auto flex items-end gap-5 px-6 pb-6 md:pb-10">
          <div className="hidden h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 text-2xl text-[#CEA549] backdrop-blur-sm sm:flex md:h-20 md:w-20 md:text-3xl">
            <i className={`fas ${icon}`}></i>
          </div>
          <Reveal>
            <h1 className="font-display italic text-white leading-[1.05] text-3xl sm:text-5xl md:text-6xl drop-shadow-lg">
              {title}
            </h1>
            <p className="text-white/70 mt-2 md:mt-3 text-xs md:text-base uppercase tracking-widest font-semibold">
              Найдено {count} наименований
            </p>
          </Reveal>
        </div>
      </div>
    </div>
  );
};

export default CategoryHero;
