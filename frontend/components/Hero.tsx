
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { HeroSlide } from '../types';
import { scrollToSection } from '../utils/scrollToSection';
import { prefersReducedMotion } from '../hooks/useLenis';

const DEFAULT_SLIDES: HeroSlide[] = [
  {
    title: 'Сантехника и мебель для ванной',
    subtitle: 'BATHROOM DESIGN',
    desc: 'Раковины, смесители, душевые системы, ванны, плитка и мебель от проверенных брендов. Подбор и доставка по Казахстану.',
    img: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?q=80&w=1600&auto=format&fit=crop',
  },
  {
    title: 'Готовые решения для вашего ремонта',
    subtitle: 'КАЧЕСТВО И СТИЛЬ',
    desc: 'Большой выбор коллекций для ванных комнат любого размера и бюджета.',
    img: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?q=80&w=1600&auto=format&fit=crop',
  },
];

interface HeroProps {
  slides?: HeroSlide[];
}

const isCoarsePointer = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

const MAGNETIC_MAX_OFFSET = 10;
const MAGNETIC_STRENGTH = 0.35;

/**
 * useMagnetic - subtle "magnetic" hover accent for pill CTA buttons: on
 * mousemove within the element, it nudges a few px toward the cursor, springing
 * back on mouseleave via GSAP `quickTo`. Skipped entirely on touch devices
 * (no mousemove there anyway) and under prefers-reduced-motion.
 */
function useMagnetic<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (prefersReducedMotion() || isCoarsePointer()) return;
    const el = ref.current;
    if (!el) return;

    const xTo = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' });

    const clamp = (v: number) => Math.max(-MAGNETIC_MAX_OFFSET, Math.min(MAGNETIC_MAX_OFFSET, v));

    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - (rect.left + rect.width / 2);
      const relY = e.clientY - (rect.top + rect.height / 2);
      xTo(clamp(relX * MAGNETIC_STRENGTH));
      yTo(clamp(relY * MAGNETIC_STRENGTH));
    };
    const onMouseLeave = () => {
      xTo(0);
      yTo(0);
    };

    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mouseleave', onMouseLeave);

    return () => {
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mouseleave', onMouseLeave);
      gsap.set(el, { x: 0, y: 0 });
    };
  }, []);

  return ref;
}

const Hero: React.FC<HeroProps> = ({ slides: propSlides }) => {
  const [current, setCurrent] = useState(0);
  const catalogBtnRef = useMagnetic<HTMLAnchorElement>();
  const aboutBtnRef = useMagnetic<HTMLButtonElement>();

  const slides = propSlides && propSlides.length > 0 ? propSlides : DEFAULT_SLIDES;

  useEffect(() => {
    setCurrent(0);
  }, [slides.length]);

  useEffect(() => {
    const timer = setInterval(() => setCurrent((p) => (p + 1) % slides.length), 8000);
    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <section className="relative min-h-screen overflow-hidden">
      {slides.map((slide, idx) => (
        <div
          key={idx}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${idx === current ? 'opacity-100' : 'opacity-0'}`}
        >
          <img src={slide.img} alt={slide.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111827]/90 via-[#1D2B49]/55 to-[#1D2B49]/25" />
          <div className="absolute inset-0 flex items-center pt-20">
            <div className="container mx-auto px-6">
              <div className={`max-w-4xl transform transition-all duration-700 ${idx === current ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
                <h2 className="text-[#CEA549] font-heading font-bold tracking-[0.2em] mb-5 uppercase text-base md:text-xl">
                  {slide.subtitle}
                </h2>
                <h1 className="font-heading font-bold text-white leading-[1.1] mb-8 text-5xl sm:text-6xl md:text-7xl lg:text-[80px] drop-shadow-lg">
                  {slide.title}
                </h1>
                <p className="text-lg md:text-2xl text-white/90 mb-12 leading-relaxed max-w-2xl font-body">
                  {slide.desc}
                </p>
                <div className="flex flex-wrap items-center gap-5">
                  <Link
                    ref={catalogBtnRef}
                    to="/catalog"
                    className="px-9 py-4 bg-[#1D2B49] hover:bg-[#152036] text-white font-heading font-semibold rounded-full transition-all text-base tracking-wide"
                  >
                    Каталог
                  </Link>
                  <button
                    ref={aboutBtnRef}
                    type="button"
                    onClick={() => scrollToSection('about')}
                    className="px-9 py-4 bg-transparent hover:bg-white/10 text-white font-heading font-semibold rounded-full transition-all text-base tracking-wide border-2 border-white"
                  >
                    О компании
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-3">
        {slides.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setCurrent(idx)}
            className={`h-1.5 rounded-full transition-all ${idx === current ? 'w-12 bg-[#CEA549]' : 'w-4 bg-white/50'}`}
          />
        ))}
      </div>
    </section>
  );
};

export default Hero;
