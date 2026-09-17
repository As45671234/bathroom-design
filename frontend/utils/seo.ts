type SeoOptions = {
  title?: string;
  description?: string;
  keywords?: string;
  canonicalUrl?: string;
  ogType?: string;
  ogImage?: string;
  ogUrl?: string;
  twitterCard?: string;
  structuredData?: Record<string, any> | Record<string, any>[];
};

const DYNAMIC_ATTR = 'data-bathroomdesign-dynamic-seo';

const META_SELECTORS = [
  ['meta[name="description"]', { name: 'description' }],
  ['meta[name="keywords"]', { name: 'keywords' }],
  ['meta[property="og:title"]', { property: 'og:title' }],
  ['meta[property="og:description"]', { property: 'og:description' }],
  ['meta[property="og:type"]', { property: 'og:type' }],
  ['meta[property="og:url"]', { property: 'og:url' }],
  ['meta[property="og:image"]', { property: 'og:image' }],
  ['meta[name="twitter:card"]', { name: 'twitter:card' }],
  ['meta[name="twitter:title"]', { name: 'twitter:title' }],
  ['meta[name="twitter:description"]', { name: 'twitter:description' }],
  ['meta[name="twitter:image"]', { name: 'twitter:image' }],
  ['link[rel="canonical"]', { rel: 'canonical' }],
] as const;

function ensureElement(selector: string, tagName: string, attrs: Record<string, string>) {
  const existing = document.head.querySelector<HTMLElement>(`${selector}[${DYNAMIC_ATTR}="true"]`)
    || document.head.querySelector<HTMLElement>(selector);

  const element = existing || document.createElement(tagName);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  element.setAttribute(DYNAMIC_ATTR, 'true');
  if (!element.parentElement) document.head.appendChild(element);
  return element;
}

function setMeta(selector: string, attrs: Record<string, string>, value?: string) {
  const existing = document.head.querySelector<HTMLElement>(`${selector}[${DYNAMIC_ATTR}="true"]`)
    || document.head.querySelector<HTMLElement>(selector);

  if (!value) {
    if (existing && existing.getAttribute(DYNAMIC_ATTR) === 'true') existing.remove();
    return;
  }

  const tagName = selector.startsWith('link[') ? 'link' : 'meta';
  const element = ensureElement(selector, tagName, attrs);
  if (tagName === 'link') {
    element.setAttribute('href', value);
  } else {
    element.setAttribute('content', value);
  }
}

export function applySeo(options: SeoOptions) {
  const previousTitle = document.title;
  const structuredDataId = 'bathroomdesign-dynamic-jsonld';

  if (options.title) document.title = options.title;

  setMeta('meta[name="description"]', { name: 'description' }, options.description);
  setMeta('meta[name="keywords"]', { name: 'keywords' }, options.keywords);
  setMeta('meta[property="og:title"]', { property: 'og:title' }, options.title);
  setMeta('meta[property="og:description"]', { property: 'og:description' }, options.description);
  setMeta('meta[property="og:type"]', { property: 'og:type' }, options.ogType);
  setMeta('meta[property="og:url"]', { property: 'og:url' }, options.ogUrl);
  setMeta('meta[property="og:image"]', { property: 'og:image' }, options.ogImage);
  setMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, options.twitterCard);
  setMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, options.title);
  setMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, options.description);
  setMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, options.ogImage);
  setMeta('link[rel="canonical"]', { rel: 'canonical' }, options.canonicalUrl);

  let structuredDataEl = document.getElementById(structuredDataId) as HTMLScriptElement | null;
  if (options.structuredData) {
    if (!structuredDataEl) {
      structuredDataEl = document.createElement('script');
      structuredDataEl.type = 'application/ld+json';
      structuredDataEl.id = structuredDataId;
      structuredDataEl.setAttribute(DYNAMIC_ATTR, 'true');
      document.head.appendChild(structuredDataEl);
    }
    structuredDataEl.textContent = JSON.stringify(options.structuredData, null, 2);
  } else if (structuredDataEl && structuredDataEl.getAttribute(DYNAMIC_ATTR) === 'true') {
    structuredDataEl.remove();
  }

  return () => {
    document.title = previousTitle;
    META_SELECTORS.forEach(([selector]) => {
      const el = document.head.querySelector<HTMLElement>(`${selector}[${DYNAMIC_ATTR}="true"]`);
      if (el) el.remove();
    });
    const script = document.getElementById(structuredDataId);
    if (script && script.getAttribute(DYNAMIC_ATTR) === 'true') script.remove();
  };
}
