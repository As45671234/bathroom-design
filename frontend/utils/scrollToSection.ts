import { getLenis } from '../hooks/useLenis';

/**
 * Smooth-scrolls to an element by id. Uses the shared Lenis instance's own
 * `scrollTo` when Lenis is active (native `scrollIntoView({behavior:'smooth'})`
 * calls fight with Lenis's virtual scroll and can behave oddly), falling back to
 * native `scrollIntoView` when Lenis wasn't instantiated (prefers-reduced-motion).
 */
export const scrollToSection = (id: string): void => {
  const el = document.getElementById(id);
  if (!el) return;

  const lenis = getLenis();
  if (lenis) {
    lenis.scrollTo(el);
  } else {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
