import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Module-level singleton so any component (Hero's anchor button, Header/Footer nav,
// CatalogPage's modal) can reach the live Lenis instance without prop-drilling or
// context. `null` means Lenis was never instantiated (prefers-reduced-motion is on),
// in which case every call site is expected to fall back to native scroll behavior.
let lenisInstance: Lenis | null = null;

export const getLenis = (): Lenis | null => lenisInstance;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * useSmoothScroll - mounts a single, site-wide Lenis instance wired into GSAP's
 * ticker + ScrollTrigger using the standard integration recipe:
 *
 *   lenis.on('scroll', ScrollTrigger.update)
 *   gsap.ticker.add((time) => lenis.raf(time * 1000))
 *   gsap.ticker.lagSmoothing(0)
 *
 * Mount this exactly once near the app root (see App.tsx) so it applies to every
 * route. Under prefers-reduced-motion it never instantiates Lenis at all, leaving
 * native scrolling completely untouched.
 */
export function useSmoothScroll(): void {
  useEffect(() => {
    if (prefersReducedMotion()) {
      lenisInstance = null;
      return;
    }

    const lenis = new Lenis({
      // Moderate, slightly "heavy" premium deceleration - noticeable inertia
      // without feeling laggy or unresponsive to use.
      duration: 1.15,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1,
    });
    lenisInstance = lenis;

    const onLenisScroll = () => ScrollTrigger.update();
    lenis.on('scroll', onLenisScroll);

    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // Lenis measures its scrollable "limit" from `document.documentElement`'s
    // size via a ResizeObserver, but the root element's observed box doesn't
    // reliably reflect content growth from async data (categories fetched from
    // the backend after mount) or images loading in - so the limit can go stale
    // and scrolling gets capped short of the real page height. `document.body`
    // resizes with its content much more reliably, so re-run `lenis.resize()`
    // whenever it changes to keep the scrollable range accurate.
    const resizeObserver = new ResizeObserver(() => lenis.resize());
    resizeObserver.observe(document.body);

    return () => {
      resizeObserver.disconnect();
      gsap.ticker.remove(tick);
      lenis.off('scroll', onLenisScroll);
      lenis.destroy();
      lenisInstance = null;
    };
  }, []);
}
