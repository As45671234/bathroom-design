import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CatalogStatus, Category, CartItem, Product, SiteSettings } from './types';
import Header from './components/Header';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import ProductPage from './pages/ProductPage';
import VisualSearchPage from './pages/VisualSearchPage';
import DesignersPage from './pages/DesignersPage';
import NotFoundPage from './pages/NotFoundPage';
import CartPage from './pages/CartPage';
import { fetchCatalog, fetchSiteSettings, getAdminToken, clearAdminToken, visualSearch, VisualSearchComponent } from './services/api';
import { useSmoothScroll, getLenis } from './hooks/useLenis';

// Only the site owner ever hits /admin — keep it out of the main bundle
// everyone else downloads.
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));

type ToastState = { msg: string; id: number; open: boolean } | null;

// Global, site-wide Lenis instance (see hooks/useLenis.ts) - mounted once here so
// smooth scrolling applies to every route.
const SmoothScroll: React.FC = () => {
  useSmoothScroll();
  return null;
};

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const lenis = getLenis();
    if (lenis) {
      lenis.scrollTo(0, { immediate: true });
    } else {
      window.scrollTo(0, 0);
    }
    // New page content mounts in the same commit; let it settle before Lenis and
    // ScrollTrigger re-measure against the new layout (see hooks/useLenis.ts for
    // why Lenis's own auto-resize isn't fully reliable on its own).
    requestAnimationFrame(() => {
      lenis?.resize();
      ScrollTrigger.refresh();
    });
  }, [pathname]);
  return null;
};

// Keeps /#/admin working as a bookmark after switching to BrowserRouter.
const HashRedirect: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#/admin')) {
      navigate('/admin', { replace: true });
    }
  }, []);
  return null;
};

// On the homepage the header floats transparently over the full-height hero photo,
// so the hero needs to start at y=0 instead of being pushed down by the fixed header's offset.
// Elsewhere the padding has to clear the fixed header: 132px tall on mobile
// (logo row + always-visible search row), 106px from md up (utility row + main row).
const MainArea: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const isHome = pathname === '/';
  return <main className={`flex-grow ${isHome ? '' : 'pt-[140px] md:pt-[118px]'}`}>{children}</main>;
};

const App: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  // An empty `categories` array means three very different things — still
  // fetching, fetch failed, or a genuinely empty shop — and pages were
  // rendering "Товары не найдены" for all three. Track them apart.
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('loading');
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const savedCart = localStorage.getItem('bathroomdesign_cart');
      return savedCart ? JSON.parse(savedCart) : [];
    } catch {
      return [];
    }
  });
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);

  // Lifted out of VisualSearchPage so a photo + its results survive
  // navigating away (e.g. opening a matched product) and back — the page
  // component itself unmounts on every route change, so state that lived
  // there was wiped and the visitor had to re-upload the same photo.
  const [visualSearchPreview, setVisualSearchPreview] = useState('');
  const [visualSearchLoading, setVisualSearchLoading] = useState(false);
  const [visualSearchError, setVisualSearchError] = useState('');
  const [visualSearchResults, setVisualSearchResults] = useState<VisualSearchComponent[] | null>(null);

  const [toast, setToast] = useState<ToastState>(null);
  const [toastTimer, setToastTimer] = useState<number | null>(null);
  const whatsappPhone = useMemo(
    () => String(import.meta.env.VITE_WHATSAPP_PHONE || '').replace(/[^\d]/g, ''),
    []
  );
  const whatsappText = useMemo(
    () => encodeURIComponent('Здравствуйте! Хочу заказать консультацию.'),
    []
  );
  const whatsappUrl = useMemo(
    () => (whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${whatsappText}` : ''),
    [whatsappPhone, whatsappText]
  );

  // Cart persistence (initial value is read lazily in useState above to avoid
  // a race where this effect would overwrite localStorage with an empty
  // array before the load could apply on first mount).
  useEffect(() => {
    localStorage.setItem('bathroomdesign_cart', JSON.stringify(cart));
  }, [cart]);

  // Catalog from backend
  useEffect(() => {
    let cancelled = false;
    setCatalogStatus('loading');
    fetchCatalog()
      .then((data) => {
        if (cancelled) return;
        setCategories((data.categories || []) as any);
        setCatalogStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setCategories([]);
        setCatalogStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [catalogReloadKey]);

  const retryCatalog = () => setCatalogReloadKey((k) => k + 1);

  // Site settings
  useEffect(() => {
    fetchSiteSettings()
      .then((data) => { if (data?.settings) setSiteSettings(data.settings as SiteSettings); })
      .catch(() => {});
  }, []);

  // Admin session (token)
  useEffect(() => {
    const t = getAdminToken();
    if (t) setIsAdminAuthenticated(true);
  }, []);

  const showToast = (msg: string) => {
    if (toastTimer) window.clearTimeout(toastTimer);

    const id = Date.now();
    setToast({ msg, id, open: true });

    const t = window.setTimeout(() => {
      setToast((prev) => (prev ? { ...prev, open: false } : prev));
      window.setTimeout(() => setToast(null), 320);
    }, 2200);

    setToastTimer(t);
  };

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });

    showToast('Товар добавлен в корзину');
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const newQty = Math.max(1, item.quantity + delta);
          return { ...item, quantity: newQty };
        }
        return item;
      })
    );
  };

  const clearCart = () => setCart([]);

  // Stable identity (useCallback) matters here: it's a dependency of the
  // document-level paste-listener effect in VisualSearchPage — a fresh
  // function reference on every App re-render (toast, cart, catalog fetch,
  // ...) would tear down and re-add that listener constantly instead of once.
  const handleVisualSearchFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setVisualSearchError('');
    setVisualSearchResults(null);
    setVisualSearchPreview(URL.createObjectURL(file));
    setVisualSearchLoading(true);
    try {
      const data = await visualSearch(file);
      setVisualSearchResults(data.components);
    } catch (e: any) {
      setVisualSearchError(e?.message || 'Не удалось обработать изображение');
    } finally {
      setVisualSearchLoading(false);
    }
  }, []);

  return (
    <Router>
      <SmoothScroll />
      <ScrollToTop />
      <HashRedirect />
      <div className="flex flex-col min-h-screen relative overflow-x-clip">
        <Header
          cartCount={cart.reduce((sum, i) => sum + i.quantity, 0)}
          categories={categories}
          phone={siteSettings?.phone}
          logoUrl={siteSettings?.homepageImages?.headerLogo}
        />

        {toast && (
          <div className="fixed right-4 top-[76px] z-[9999] pointer-events-none">
            <div
              className={[
                'bg-[#1D2B49] text-white px-4 py-3 rounded-2xl shadow-lg text-sm font-semibold',
                'transition-all duration-300 ease-out',
                toast.open ? 'translate-x-0 opacity-100' : 'translate-x-[120%] opacity-0',
              ].join(' ')}
            >
              {toast.msg}
            </div>
          </div>
        )}

        <MainArea>
          <Routes>
            <Route
              path="/"
              element={
                <HomePage
                  categories={categories}
                  catalogStatus={catalogStatus}
                  onAddToCart={addToCart}
                  siteSettings={siteSettings}
                />
              }
            />
            <Route
              path="/catalog"
              element={
                <CatalogPage
                  categories={categories}
                  catalogStatus={catalogStatus}
                  onRetryCatalog={retryCatalog}
                  onAddToCart={addToCart}
                />
              }
            />
            <Route
              path="/product/:id"
              element={
                <ProductPage
                  categories={categories}
                  catalogStatus={catalogStatus}
                  onRetryCatalog={retryCatalog}
                  onAddToCart={addToCart}
                  phone={siteSettings?.phone}
                />
              }
            />
            <Route
              path="/visual-search"
              element={
                <VisualSearchPage
                  onAddToCart={addToCart}
                  preview={visualSearchPreview}
                  loading={visualSearchLoading}
                  error={visualSearchError}
                  results={visualSearchResults}
                  onFileSelected={handleVisualSearchFile}
                />
              }
            />
            <Route path="/designers" element={<DesignersPage />} />
            <Route
              path="/cart"
              element={
                <CartPage
                  cart={cart}
                  removeFromCart={removeFromCart}
                  updateQuantity={updateQuantity}
                  clearCart={clearCart}
                  phone={siteSettings?.phone}
                />
              }
            />
            <Route
              path="/admin"
              element={
                <Suspense fallback={null}>
                  {isAdminAuthenticated ? (
                    <AdminDashboard
                      categories={categories}
                      setCategories={setCategories}
                      onLogout={() => {
                        clearAdminToken();
                        setIsAdminAuthenticated(false);
                      }}
                    />
                  ) : (
                    <AdminLogin onLogin={() => setIsAdminAuthenticated(true)} />
                  )}
                </Suspense>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </MainArea>

        <Footer siteSettings={siteSettings} categories={categories} />
      </div>
      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="wa-fab fixed right-5 bottom-5 z-[9999] w-14 h-14 rounded-full bg-green-500 text-white shadow-2xl flex items-center justify-center hover:bg-green-600 transition-[bottom] duration-300"
          aria-label="WhatsApp"
        >
          <i className="fab fa-whatsapp text-2xl"></i>
        </a>
      ) : null}
    </Router>
  );
};

export default App;
