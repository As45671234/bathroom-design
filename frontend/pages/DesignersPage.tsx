import React, { useEffect, useState } from 'react';
import { Designer } from '../types';
import { fetchDesigners } from '../services/api';
import { normalizeAssetUrl } from '../utils/assetUrl';
import { toPlainPhone } from '../utils/phone';
import { applySeo } from '../utils/seo';
import Reveal from '../components/Reveal';
import LeadForm from '../components/LeadForm';

interface LightboxState {
  images: string[];
  index: number;
}

const DesignersPage: React.FC = () => {
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeDesigner, setActiveDesigner] = useState<Designer | null>(null);
  const [leadDesigner, setLeadDesigner] = useState<Designer | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  useEffect(
    () =>
      applySeo({
        title: 'Рекомендуемые дизайнеры | Bathroom Design',
        description: 'Дизайнеры интерьера ванных комнат, с которыми сотрудничает Bathroom Design — портфолио, контакты и специальные условия на комплектацию сантехники.',
      }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchDesigners()
      .then((data) => {
        if (cancelled) return;
        setDesigners((data.designers || []) as Designer[]);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A background scrolling behind an open modal is disorienting — lock it,
  // same pattern Header.tsx uses for its mobile menu.
  useEffect(() => {
    const locked = !!(activeDesigner || leadDesigner || lightbox);
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [activeDesigner, leadDesigner, lightbox]);

  // Escape closes whatever's on top; arrow keys page through an open lightbox.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(null);
        else if (leadDesigner) setLeadDesigner(null);
        else if (activeDesigner) setActiveDesigner(null);
        return;
      }
      if (!lightbox) return;
      if (e.key === 'ArrowRight') {
        setLightbox((lb) => (lb ? { ...lb, index: (lb.index + 1) % lb.images.length } : lb));
      } else if (e.key === 'ArrowLeft') {
        setLightbox((lb) => (lb ? { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length } : lb));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightbox, leadDesigner, activeDesigner]);

  const openProfile = (d: Designer) => setActiveDesigner(d);
  const openLightbox = (images: string[], index: number) => setLightbox({ images, index });

  return (
    <div className="pb-24">
      {/* Hero - interior photo under a navy wash; the copy is centred, so the
          overlay is even rather than side-weighted like CategoryHero's. */}
      <div className="relative overflow-hidden bg-[#1D2B49] py-16 md:py-24">
        <img
          src="/assets/hero/designers-bg.webp"
          alt=""
          aria-hidden="true"
          loading="eager"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-[#1D2B49]/65" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0f1729]/60 via-transparent to-[#0f1729]/60" />
        <div className="container relative mx-auto px-6 text-center">
          <Reveal>
            <div className="text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Партнёры</div>
            <h1 className="mt-3 font-display italic text-4xl leading-[1.1] text-white drop-shadow-lg sm:text-5xl md:text-6xl">
              Рекомендуемые дизайнеры
            </h1>
            <div className="mx-auto mt-5 h-px w-16 bg-[#CEA549]/50" />
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-white/75 md:text-base">
              Сильные дизайнеры интерьера Казахстана, с которыми мы сотрудничаем. Закажите проект у
              партнёра — и получите скидку на комплектацию сантехники в BATHROOM design.
            </p>
            <div className="mx-auto mt-7 flex max-w-xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs font-black uppercase tracking-widest text-[#CEA549]">
              <span>Красивый проект</span>
              <span className="text-white/25">•</span>
              <span>Профессиональная комплектация</span>
              <span className="text-white/25">•</span>
              <span>Выгодные условия</span>
            </div>
            {status === 'ready' && designers.length > 0 ? (
              <div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white/80 backdrop-blur-sm">
                <i className="fas fa-user-tie text-[#CEA549]"></i>
                {designers.length} {pluralize(designers.length, ['дизайнер', 'дизайнера', 'дизайнеров'])}{' '}
                {pluralize(designers.length, ['готов', 'готовы', 'готовы'])} помочь
              </div>
            ) : null}
          </Reveal>
        </div>
      </div>

      <div className="container mx-auto px-6">
        {status === 'loading' ? (
          <div className="grid grid-cols-1 gap-8 py-16 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
                <div className="aspect-[3/4] animate-pulse bg-gray-200" />
                <div className="space-y-3 p-6">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
                  <div className="h-10 animate-pulse rounded-2xl bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <div className="py-24 text-center">
            <i className="fas fa-triangle-exclamation mb-4 text-3xl text-gray-300"></i>
            <p className="text-gray-400">Не удалось загрузить список дизайнеров. Попробуйте обновить страницу.</p>
          </div>
        ) : designers.length === 0 ? (
          <div className="py-24 text-center">
            <i className="fas fa-user-tie mb-4 text-3xl text-gray-300"></i>
            <p className="text-gray-400">Пока никого не добавили — загляните позже.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 py-16 sm:grid-cols-2 lg:grid-cols-3">
            {designers.map((d, idx) => (
              <DesignerCard key={d.id} designer={d} index={idx} onOpenProfile={() => openProfile(d)} onOpenLead={() => setLeadDesigner(d)} />
            ))}
          </div>
        )}
      </div>

      {/* Profile modal */}
      {activeDesigner ? (
        <ProfileModal
          designer={activeDesigner}
          onClose={() => setActiveDesigner(null)}
          onRequestConsult={() => {
            setLeadDesigner(activeDesigner);
            setActiveDesigner(null);
          }}
          onOpenLightbox={(idx) => openLightbox((activeDesigner.portfolio || []).map((src) => normalizeAssetUrl(src)), idx)}
        />
      ) : null}

      {/* Portfolio lightbox */}
      {lightbox ? (
        <PortfolioLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox((lb) => (lb ? { ...lb, index } : lb))}
        />
      ) : null}

      {/* Lead / consultation request modal */}
      {leadDesigner ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setLeadDesigner(null)}
        >
          <div
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h4 className="font-heading text-xl font-bold text-[#1D2B49]">Заявка на консультацию</h4>
                <p className="mt-1 text-sm text-gray-400">Дизайнер: {leadDesigner.name}</p>
              </div>
              <button
                onClick={() => setLeadDesigner(null)}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gray-100 transition-colors hover:bg-gray-200"
                aria-label="Закрыть"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <LeadForm
              initialMessage={`Хочу проконсультироваться с дизайнером: ${leadDesigner.name}`}
              submitLabel="Отправить заявку"
              onSuccess={() => setLeadDesigner(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

// ---------------- Card ----------------

interface DesignerCardProps {
  designer: Designer;
  index: number;
  onOpenProfile: () => void;
  onOpenLead: () => void;
}

const DesignerCard: React.FC<DesignerCardProps> = ({ designer: d, index, onOpenProfile, onOpenLead }) => {
  const photo = normalizeAssetUrl(d.photo);
  const portfolioCount = d.portfolio?.length || 0;
  const hasContacts = !!(d.phone || d.whatsappUrl || d.instagramUrl);
  const whatsapp = designerWhatsappUrl(d);

  return (
    <Reveal
      index={index}
      className="group flex flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
    >
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={`Открыть профиль: ${d.name}`}
        className="relative block aspect-[3/4] w-full overflow-hidden bg-gray-100 text-left"
      >
        {photo ? (
          <img
            src={photo}
            alt={d.name}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1D2B49] to-[#0f1729]">
            <i className="fas fa-user-tie text-6xl text-white/15"></i>
          </div>
        )}

        {/* Editorial gradient + name overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

        {d.experienceYears ? (
          <div className="absolute left-4 top-4 rounded-full bg-[#CEA549] px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-white shadow">
            Опыт {d.experienceYears} {pluralize(d.experienceYears, ['год', 'года', 'лет'])}
          </div>
        ) : null}
        {portfolioCount > 0 ? (
          <div className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-[#1D2B49] shadow backdrop-blur-sm">
            <i className="fas fa-images text-[10px]"></i>
            {portfolioCount}
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 p-5">
          <h3 className="font-heading text-xl font-bold text-white drop-shadow-sm">{d.name}</h3>
          {d.position ? (
            <div className="mt-0.5 text-xs font-bold uppercase tracking-widest text-[#CEA549]">{d.position}</div>
          ) : null}
        </div>
      </button>

      <div className="flex flex-1 flex-col p-6">
        {d.bio ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-gray-500">{d.bio}</p>
        ) : (
          <p className="text-sm leading-relaxed text-gray-300">Дизайнер команды Bathroom Design.</p>
        )}

        <div className="mt-5 flex flex-1 flex-col justify-end gap-4">
          {hasContacts ? (
            <div className="flex items-center gap-2">
              {d.phone ? (
                <a
                  href={`tel:${d.phone.replace(/\s/g, '')}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-[#1D2B49] transition-colors hover:bg-[#1D2B49] hover:text-white"
                  aria-label={`Позвонить ${d.name}`}
                >
                  <i className="fas fa-phone text-sm"></i>
                </a>
              ) : null}
              {d.whatsappUrl ? (
                <a
                  href={d.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-[#1D2B49] transition-colors hover:bg-green-500 hover:text-white"
                  aria-label={`WhatsApp ${d.name}`}
                >
                  <i className="fab fa-whatsapp text-sm"></i>
                </a>
              ) : null}
              {d.instagramUrl ? (
                <a
                  href={d.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-[#1D2B49] transition-colors hover:bg-[#CEA549] hover:text-white"
                  aria-label={`Instagram ${d.name}`}
                >
                  <i className="fab fa-instagram text-sm"></i>
                </a>
              ) : null}
              <button
                type="button"
                onClick={onOpenProfile}
                className="ml-auto text-xs font-bold uppercase tracking-widest text-[#1D2B49] underline decoration-[#CEA549] decoration-2 underline-offset-4 transition-colors hover:text-[#CEA549]"
              >
                Подробнее
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenProfile}
              className="self-start text-xs font-bold uppercase tracking-widest text-[#1D2B49] underline decoration-[#CEA549] decoration-2 underline-offset-4 transition-colors hover:text-[#CEA549]"
            >
              Подробнее
            </button>
          )}

          {whatsapp ? (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1D2B49] py-3 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-[#152036]"
            >
              <i className="fab fa-whatsapp text-base"></i>
              Записаться на консультацию
            </a>
          ) : (
            <button
              type="button"
              onClick={onOpenLead}
              className="w-full rounded-2xl bg-[#1D2B49] py-3 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-[#152036]"
            >
              Записаться на консультацию
            </button>
          )}
        </div>
      </div>
    </Reveal>
  );
};

// ---------------- Profile modal ----------------

interface ProfileModalProps {
  designer: Designer;
  onClose: () => void;
  onRequestConsult: () => void;
  onOpenLightbox: (index: number) => void;
}

const ProfileModal: React.FC<ProfileModalProps> = ({ designer: d, onClose, onRequestConsult, onOpenLightbox }) => {
  const photo = normalizeAssetUrl(d.photo);
  const portfolio = d.portfolio || [];
  const whatsapp = designerWhatsappUrl(d);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr]">
          {/* Photo column */}
          <div className="relative aspect-[4/5] flex-shrink-0 bg-gray-100 md:aspect-auto md:h-full">
            {photo ? (
              <img src={photo} alt={d.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1D2B49] to-[#0f1729]">
                <i className="fas fa-user-tie text-5xl text-white/15"></i>
              </div>
            )}
            <button
              onClick={onClose}
              className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 md:hidden"
              aria-label="Закрыть"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>

          {/* Info column */}
          <div className="relative p-6 md:p-8">
            <button
              onClick={onClose}
              className="absolute right-6 top-6 hidden h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gray-100 transition-colors hover:bg-gray-200 md:flex"
              aria-label="Закрыть"
            >
              <i className="fas fa-times"></i>
            </button>

            <h4 className="font-heading text-2xl font-bold text-[#1D2B49] md:pr-12">{d.name}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {d.position ? (
                <span className="text-xs font-bold uppercase tracking-widest text-[#CEA549]">{d.position}</span>
              ) : null}
              {d.experienceYears ? (
                <span className="text-xs font-semibold text-gray-400">
                  Опыт {d.experienceYears} {pluralize(d.experienceYears, ['год', 'года', 'лет'])}
                </span>
              ) : null}
            </div>

            {d.bio ? (
              <div className="relative mt-6">
                <i className="fas fa-quote-left absolute -left-1 -top-2 text-2xl text-[#CEA549]/20"></i>
                <p className="whitespace-pre-wrap pl-5 text-sm leading-relaxed text-gray-600">{d.bio}</p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2.5">
              {d.phone ? (
                <a
                  href={`tel:${d.phone.replace(/\s/g, '')}`}
                  className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2.5 text-sm font-bold text-[#1D2B49] transition-colors hover:bg-[#1D2B49] hover:text-white"
                >
                  <i className="fas fa-phone text-xs"></i> {d.phone}
                </a>
              ) : null}
              {d.email ? (
                <a
                  href={`mailto:${d.email}`}
                  className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2.5 text-sm font-bold text-[#1D2B49] transition-colors hover:bg-[#1D2B49] hover:text-white"
                >
                  <i className="fas fa-envelope text-xs"></i> {d.email}
                </a>
              ) : null}
              {d.whatsappUrl ? (
                <a
                  href={d.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2.5 text-sm font-bold text-[#1D2B49] transition-colors hover:bg-green-500 hover:text-white"
                >
                  <i className="fab fa-whatsapp text-xs"></i> WhatsApp
                </a>
              ) : null}
              {d.instagramUrl ? (
                <a
                  href={d.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2.5 text-sm font-bold text-[#1D2B49] transition-colors hover:bg-[#CEA549] hover:text-white"
                >
                  <i className="fab fa-instagram text-xs"></i> Instagram
                </a>
              ) : null}
            </div>

            {whatsapp ? (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1D2B49] py-3.5 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-[#152036] md:inline-flex md:w-auto md:px-8"
              >
                <i className="fab fa-whatsapp text-base"></i>
                Записаться на консультацию
              </a>
            ) : (
              <button
                type="button"
                onClick={onRequestConsult}
                className="mt-6 w-full rounded-2xl bg-[#1D2B49] py-3.5 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-[#152036] md:w-auto md:px-8"
              >
                Записаться на консультацию
              </button>
            )}
          </div>
        </div>

        {portfolio.length > 0 ? (
          <div className="border-t border-gray-100 p-6 md:p-8">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">Портфолио</div>
              <div className="text-xs font-semibold text-gray-300">
                {portfolio.length} {pluralize(portfolio.length, ['работа', 'работы', 'работ'])}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {portfolio.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpenLightbox(i)}
                  className="group/thumb aspect-square overflow-hidden rounded-2xl bg-gray-100"
                  aria-label={`Открыть фото ${i + 1} из портфолио`}
                >
                  <img
                    src={normalizeAssetUrl(src)}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-500 group-hover/thumb:scale-110"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ---------------- Portfolio lightbox ----------------

interface PortfolioLightboxProps {
  images: string[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const PortfolioLightbox: React.FC<PortfolioLightboxProps> = ({ images, index, onClose, onNavigate }) => {
  const hasMultiple = images.length > 1;
  const goPrev = () => onNavigate((index - 1 + images.length) % images.length);
  const goNext = () => onNavigate((index + 1) % images.length);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Закрыть"
      >
        <i className="fas fa-times text-lg"></i>
      </button>

      {hasMultiple ? (
        <div className="absolute left-4 top-4 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white/70">
          {index + 1} / {images.length}
        </div>
      ) : null}

      {hasMultiple ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-6"
          aria-label="Предыдущее фото"
        >
          <i className="fas fa-chevron-left"></i>
        </button>
      ) : null}

      <img
        src={images[index]}
        alt=""
        className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />

      {hasMultiple ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-6"
          aria-label="Следующее фото"
        >
          <i className="fas fa-chevron-right"></i>
        </button>
      ) : null}
    </div>
  );
};

/**
 * "Записаться на консультацию" goes straight to the designer's WhatsApp.
 * `whatsappUrl` is typed by hand in the admin ("wa.me/7707…", often without a
 * scheme), so it gets normalised here; when it's empty the link is built from
 * the phone instead. Returns '' if the designer has neither - the caller then
 * falls back to the lead form.
 */
const CONSULT_GREETING = 'Здравствуйте! Хочу проконсультироваться по ванной комнате.';

function designerWhatsappUrl(d: Designer) {
  const raw = String(d.whatsappUrl || '').trim();
  if (raw) {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(href);
      // Don't clobber a greeting the admin already put in the link.
      if (!url.searchParams.has('text')) url.searchParams.set('text', CONSULT_GREETING);
      return url.toString();
    } catch {
      return href;
    }
  }
  const phone = toPlainPhone(d.phone || '').replace('+', '');
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(CONSULT_GREETING)}` : '';
}

function pluralize(n: number, forms: [string, string, string]) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export default DesignersPage;
