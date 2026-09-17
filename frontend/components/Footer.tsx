
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Category, SiteSettings } from '../types';
import { normalizeAssetUrl } from '../utils/assetUrl';
import { scrollToSection } from '../utils/scrollToSection';
import Reveal from './Reveal';
import logoImg from './img/logo-transparent.png';

interface FooterProps {
  siteSettings?: SiteSettings | null;
  categories?: Category[];
}


const Footer: React.FC<FooterProps> = ({ siteSettings, categories }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const whatsappPhone = String(import.meta.env.VITE_WHATSAPP_PHONE || '').replace(/[^\d]/g, '');
  const whatsappUrl = whatsappPhone
    ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent('Здравствуйте! Хочу заказать консультацию.')}`
    : '';
  const phone = siteSettings?.phone || '+7 700 000 00 00';
  const email = siteSettings?.email || 'info@bathroomdesign.kz';
  const address = siteSettings?.address || 'г. Алматы';
  const kaspiEnabled = siteSettings?.kaspiEnabled ?? true;
  const halykEnabled = siteSettings?.halykEnabled ?? false;
  const kaspiUrl = siteSettings?.kaspiUrl || '';
  const halykUrl = siteSettings?.halykUrl || '';
  const logoUrl = normalizeAssetUrl(siteSettings?.homepageImages?.footerLogo) || logoImg;

  const goToSection = (id: string) => {
    const doScroll = () => scrollToSection(id);

    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(doScroll, 50);
    } else {
      setTimeout(doScroll, 0);
    }
  };

  // Only networks the owner has actually filled in (admin → Настройки → Соцсети)
  // get an icon — placeholder "#" links looked clickable and went nowhere.
  const socialLinks = [
    { icon: 'fa-instagram', href: siteSettings?.instagramUrl || '', label: 'Instagram' },
    { icon: 'fa-facebook-f', href: siteSettings?.facebookUrl || '', label: 'Facebook' },
    { icon: 'fa-whatsapp', href: whatsappUrl, label: 'WhatsApp' },
  ].filter((s) => Boolean(s.href));

  // The category list used to sit in a fixed-height box with an internal
  // scrollbar (max-h-64 overflow-y-auto) — with 10 categories that scrollbar
  // sat awkwardly in the middle of the footer. Cap the list instead and send
  // the rest to the full catalog, so the footer never needs its own scrollbar.
  const CATALOG_FOOTER_LIMIT = 8;
  const catalogShown = (categories || []).slice(0, CATALOG_FOOTER_LIMIT);
  const catalogRest = Math.max(0, (categories?.length || 0) - CATALOG_FOOTER_LIMIT);

  return (
    <footer className="relative overflow-hidden bg-[#1D2B49] pt-20 pb-10 text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="container relative mx-auto px-6">
        <Reveal className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-display italic text-3xl md:text-4xl mb-4">Остались вопросы?</h2>
          <p className="text-white/60 text-sm md:text-base">
            Оставьте заявку или свяжитесь с нами любым удобным способом — поможем подобрать сантехнику под ваш проект.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
              >
                <i className="fab fa-whatsapp text-base"></i> Написать в WhatsApp
              </a>
            ) : null}
            <a
              href={`tel:${phone.replace(/\s/g, '')}`}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#CEA549] hover:text-[#CEA549]"
            >
              <i className="fas fa-phone text-sm"></i> Позвонить
            </a>
          </div>
        </Reveal>

        <div className={`grid grid-cols-1 sm:grid-cols-2 ${categories && categories.length > 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-12 mb-16 border-t border-white/10 pt-14`}>
          {/* Contacts */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-[0.2em] text-[#CEA549] mb-6">Контакты</h4>
            <a href={`tel:${phone.replace(/\s/g, '')}`} className="block text-2xl md:text-3xl font-heading font-semibold text-white hover:text-[#CEA549] transition-colors mb-2">
              {phone}
            </a>
            <div className="text-white/50 text-xs uppercase font-bold tracking-wide mb-6">ПН – СБ, 09:00 – 18:00</div>
            <div className="space-y-3 text-sm text-white/70">
              <div className="flex items-center gap-3">
                <i className="fas fa-envelope text-[#CEA549]"></i>
                <a href={`mailto:${email}`} className="hover:text-white transition-colors">{email}</a>
              </div>
              <div className="flex items-center gap-3">
                <i className="fas fa-map-marker-alt text-[#CEA549]"></i>
                <span>{address}</span>
              </div>
            </div>
          </div>

          {/* Category sitemap */}
          {categories && categories.length > 0 ? (
            <div>
              <h4 className="text-xs font-black uppercase tracking-[0.2em] text-[#CEA549] mb-6">Каталог</h4>
              <ul className="space-y-3 text-sm text-white/70">
                {catalogShown.map((cat) => (
                  <li key={cat.id}>
                    <Link to={`/catalog?cat=${cat.id}`} className="hover:text-white transition-colors">{cat.title}</Link>
                  </li>
                ))}
              </ul>
              {catalogRest > 0 ? (
                <Link
                  to="/catalog?cat=all"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[#CEA549] hover:text-white transition-colors"
                >
                  Ещё {catalogRest} <i className="fas fa-arrow-right text-[10px]"></i>
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* Quick links */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-[0.2em] text-[#CEA549] mb-6">Разделы</h4>
            <ul className="space-y-3 text-sm text-white/70">
              <li>
                <Link to="/catalog" className="hover:text-white transition-colors">Каталог</Link>
              </li>
              <li>
                <Link to="/designers" className="hover:text-white transition-colors">Дизайнеры</Link>
              </li>
              <li>
                <button type="button" onClick={() => goToSection('about')} className="hover:text-white transition-colors text-left">
                  О компании
                </button>
              </li>
              <li>
                <button type="button" onClick={() => goToSection('contacts')} className="hover:text-white transition-colors text-left">
                  Контакты
                </button>
              </li>
              <li>
                <Link to="/cart" className="hover:text-white transition-colors">Корзина</Link>
              </li>
            </ul>
          </div>

          {/* Warranty */}
          <div>
            <h4 className="mb-6 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-[#CEA549]">
              <i className="fas fa-shield-halved"></i> Гарантия
            </h4>
            <p className="text-sm text-white/60 leading-relaxed">
              Мы работаем только с проверенными брендами и предоставляем официальную гарантию производителя на всю
              сантехнику, мебель и аксессуары. При обнаружении заводского брака — бесплатная замена или ремонт.
            </p>
          </div>
        </div>

        {(kaspiEnabled || halykEnabled) && (
          <div className="mb-10 flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/50">Наш магазин</div>
              <div className="mt-1 text-sm font-semibold text-white">Оплата картой, Kaspi и Halyk</div>
            </div>
            <div className="flex flex-wrap gap-3">
              {kaspiEnabled && kaspiUrl ? (
                <a
                  href={kaspiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[#ef3124] px-4 py-2.5 text-sm font-black uppercase tracking-wide text-white transition-all duration-200 hover:-translate-y-0.5"
                >
                  Kaspi
                </a>
              ) : null}
              {halykEnabled && halykUrl ? (
                <a
                  href={halykUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[#00a651] px-4 py-2.5 text-sm font-black uppercase tracking-wide text-white transition-all duration-200 hover:-translate-y-0.5"
                >
                  Halyk
                </a>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex justify-center mb-10">
          <img src={logoUrl} alt="Bathroom Design" className="h-12 object-contain logo-on-dark opacity-90" />
        </div>

        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
            © {new Date().getFullYear()} Bathroom Design. Все права защищены.
          </div>
          {socialLinks.length > 0 ? (
            <div className="flex gap-3">
              {socialLinks.map((s) => (
                <a
                  key={s.icon}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#CEA549] flex items-center justify-center transition-all text-sm"
                >
                  <i className={`fab ${s.icon}`}></i>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
};

export default Footer;
