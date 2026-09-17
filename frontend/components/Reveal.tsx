
import React, { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Shared media query check for users who've asked the OS to minimize motion.
// Kept as a plain function (not a hook) so it can be read once at mount time.
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  /** Stagger index for grids - adds idx * 60ms delay, capped at ~400ms. */
  index?: number;
  as?: React.ElementType;
}

/**
 * <Reveal> - drop-in wrapper that animates its children in as they scroll into
 * view, GSAP + ScrollTrigger powered: a snappy fade/rise/scale-in
 * (`power3.out`) rather than a linear CSS fade+translate, triggered once per
 * element (`start: 'top 85%'`, plays only on the way down).
 *
 * Respects prefers-reduced-motion: renders children in their final state
 * immediately and never registers a ScrollTrigger.
 */
const Reveal: React.FC<RevealProps> = ({ children, className = '', index = 0, as = 'div' }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [reducedMotion] = useState(prefersReducedMotion);
  const Tag = as as React.ElementType;

  useLayoutEffect(() => {
    if (reducedMotion) return;
    const node = ref.current;
    if (!node) return;

    const delay = Math.min(index * 0.06, 0.4);

    const ctx = gsap.context(() => {
      gsap.from(node, {
        opacity: 0,
        y: 40,
        scale: 0.96,
        duration: 0.8,
        delay,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: node,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      });
    });

    return () => ctx.revert();
  }, [reducedMotion, index]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
};

export default Reveal;
