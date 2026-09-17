import React, { useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Category } from '../types';
import { normalizeAssetUrl } from '../utils/assetUrl';
import { scrollToSection } from '../utils/scrollToSection';
import SearchBox from './SearchBox';
import logoImg from './img/logo-transparent.png';

interface HeaderProps {
  cartCount: number;
  categories: Category[];
  phone?: string;
  logoUrl?: string;
}

const Header: React.FC<HeaderProps> = ({ cartCount, categories, phone, logoUrl }) => {
  const PHONE = phone || '+7 700 000 00 00';
  const LOGO_URL = normalizeAssetUrl(logoUrl) || logoImg;
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const isHome = location.pathname === '/';
  // Transparent, overlaid-on-hero look only applies at the top of the homepage.
  const isTransparent = isHome && !isScrolled;

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true } as any);
    return () => window.removeEventListener('scroll', handleScroll as any);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // A mobile menu that stays open behind the page while it scrolls is a common
  // way to get lost — lock the page body instead.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileMenuOpen]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.title.localeCompare(b.title, 'ru')),
    [categories]
  );

  const goToSection = (id: string) => {
    const doScroll = () => scrollToSection(id);

    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(doScroll, 50);
    } else {
      setTimeout(doScroll, 0);
    }
  };

  const textColor = isTransparent ? 'text-white' : 'text-[#1D2B49]';
  const hoverColor = 'hover:text-[#CEA549]';

  return (
    <header
      className={`fixed left-0 top-0 z-[60] w-full transition-all duration-300 ease-out ${
        isTransparent ? 'bg-black/20 backdrop-blur-sm' : 'border-b border-gray-100 bg-white shadow-md'
      }`}
    >
      {/* Utility row — secondary links that shouldn't compete with search */}
      <div
        className={`hidden md:block ${
          isTransparent ? 'border-b border-white/20' : 'border-b border-gray-100'
        }`}
      >
        <div className="container mx-auto flex items-center justify-between px-6 py-2">
          <div className="flex items-center gap-6">
            <button
              onClick={() => goToSection('about')}
              className={`text-xs font-semibold ${textColor} ${hoverColor} transition-colors`}
            >
              О компании
            </button>
            <button
              onClick={() => goToSection('contacts')}
              className={`text-xs font-semibold ${textColor} ${hoverColor} transition-colors`}
            >
              Контакты
            </button>
            <Link
              to="/designers"
              className={`text-xs font-semibold ${textColor} ${hoverColor} transition-colors`}
            >
              Дизайнеры
            </Link>
            <Link
              to="/visual-search"
              className={`inline-flex items-center gap-2 text-xs font-semibold ${textColor} ${hoverColor} transition-colors`}
            >
              <i className="fas fa-camera text-[11px]"></i>
              Подбор по фото
            </Link>
          </div>
          <div className={`text-xs font-semibold ${isTransparent ? 'text-white/70' : 'text-gray-400'}`}>
            ПН – СБ, 09:00 – 18:00
          </div>
        </div>
      </div>

      {/* Main row */}
      <div className="container mx-auto flex items-center gap-4 px-4 py-3 sm:px-6 lg:gap-6">
        <Link to="/" className="flex-shrink-0" aria-label="Bathroom Design — на главную">
          <img
            src={LOGO_URL}
            alt="Bathroom Design"
            className={`h-9 object-contain transition-all duration-300 md:h-10 ${isTransparent ? 'logo-on-dark' : ''}`}
          />
        </Link>

        {/* Catalog dropdown (desktop) */}
        <div className="group relative hidden flex-shrink-0 md:block">
          <Link
            to="/catalog"
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-heading text-sm font-semibold uppercase tracking-wider transition-colors ${
              isTransparent ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'
            }`}
          >
            <i className="fas fa-bars-staggered text-xs"></i>
            Каталог
          </Link>
          {sortedCategories.length > 0 ? (
            <div className="pointer-events-none absolute left-0 top-full pt-3 opacity-0 transition-all group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="min-w-[280px] rounded-2xl border border-gray-100 bg-white p-3 shadow-2xl">
                <Link
                  to="/catalog?cat=all"
                  className="block rounded-xl px-4 py-2 text-sm font-semibold text-[#1D2B49] transition-all hover:bg-gray-50"
                >
                  Все товары
                </Link>
                <div className="my-2 h-px bg-gray-100" />
                {sortedCategories.map((cat) => (
                  <Link
                    key={cat.id}
                    to={`/catalog?cat=${cat.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl px-4 py-2 text-sm text-[#1D2B49] transition-all hover:bg-gray-50"
                  >
                    <span>{cat.title}</span>
                    <span className="text-[11px] font-bold text-gray-300">{cat.items?.length || 0}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Search — the primary way into a 350-product catalog */}
        <SearchBox categories={categories} onDark={isTransparent} className="hidden min-w-0 flex-grow md:block" />

        <div className="ml-auto flex flex-shrink-0 items-center gap-2 sm:gap-4">
          <a
            href={`tel:${PHONE.replace(/\s/g, '')}`}
            className={`hidden items-center gap-2 text-sm font-bold lg:flex ${textColor} ${hoverColor} transition-colors`}
          >
            <i className="fas fa-phone text-xs"></i>
            <span>{PHONE}</span>
          </a>
          <Link
            to="/cart"
            aria-label={cartCount > 0 ? `Корзина, товаров: ${cartCount}` : 'Корзина'}
            className={`relative rounded-full p-2.5 transition-all ${textColor} ${
              isTransparent ? 'hover:bg-white/15' : 'hover:bg-gray-100'
            }`}
          >
            <i className="fas fa-shopping-cart text-lg"></i>
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#CEA549] text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>
          <button
            className={`rounded-full p-2.5 md:hidden ${textColor}`}
            aria-label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <i className={`fas ${mobileMenuOpen ? 'fa-times' : 'fa-bars'} text-xl`}></i>
          </button>
        </div>
      </div>

      {/* Mobile search row — always visible, no tap needed to reveal it */}
      <div className={`px-4 pb-3 md:hidden ${isTransparent ? '' : 'border-t border-gray-50 pt-1'}`}>
        <SearchBox categories={categories} onDark={isTransparent} onNavigate={() => setMobileMenuOpen(false)} />
      </div>

      {mobileMenuOpen && (
        <div className="absolute left-0 top-full max-h-[calc(100vh-140px)] w-full overflow-y-auto border-t border-gray-100 bg-white p-6 shadow-xl md:hidden">
          <div className="flex flex-col gap-4">
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between text-left font-heading text-lg font-bold text-[#1D2B49]"
                onClick={() => setMobileCatalogOpen((prev) => !prev)}
                aria-expanded={mobileCatalogOpen}
              >
                Каталог <i className={`fas fa-chevron-${mobileCatalogOpen ? 'up' : 'down'} text-xs`}></i>
              </button>
              {mobileCatalogOpen ? (
                <div className="mt-3 flex flex-col gap-3 pl-3">
                  <Link
                    to="/catalog?cat=all"
                    className="text-base font-semibold text-[#1D2B49]"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Все товары
                  </Link>
                  {sortedCategories.map((cat) => (
                    <Link
                      key={cat.id}
                      to={`/catalog?cat=${cat.id}`}
                      className="flex items-center justify-between gap-3 text-base text-[#1D2B49]/80"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <span>{cat.title}</span>
                      <span className="text-xs font-bold text-gray-300">{cat.items?.length || 0}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <Link
              to="/visual-search"
              className="flex items-center gap-3 font-heading text-lg font-bold text-[#1D2B49]"
              onClick={() => setMobileMenuOpen(false)}
            >
              <i className="fas fa-camera"></i>
              Подбор по фото
            </Link>

            <Link
              to="/designers"
              className="flex items-center gap-3 font-heading text-lg font-bold text-[#1D2B49]"
              onClick={() => setMobileMenuOpen(false)}
            >
              <i className="fas fa-user-tie"></i>
              Дизайнеры
            </Link>

            <button
              className="text-left font-heading text-lg font-bold text-[#1D2B49]"
              onClick={() => {
                setMobileMenuOpen(false);
                goToSection('about');
              }}
            >
              О компании
            </button>
            <button
              className="text-left font-heading text-lg font-bold text-[#1D2B49]"
              onClick={() => {
                setMobileMenuOpen(false);
                goToSection('contacts');
              }}
            >
              Контакты
            </button>

            <a href={`tel:${PHONE.replace(/\s/g, '')}`} className="flex items-center gap-3 text-lg font-bold text-[#1D2B49]">
              <i className="fas fa-phone"></i>
              {PHONE}
            </a>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
