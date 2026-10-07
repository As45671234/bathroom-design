import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { applySeo } from '../utils/seo';
import Reveal from '../components/Reveal';
import LeadForm from '../components/LeadForm';

const SUPPORT_ITEMS: { icon: string; text: string }[] = [
  { icon: 'fa-circle-question', text: 'Консультация по эксплуатации продукции' },
  { icon: 'fa-magnifying-glass', text: 'Помощь в определении причины неисправности' },
  { icon: 'fa-file-shield', text: 'Сопровождение гарантийного обращения' },
  { icon: 'fa-screwdriver-wrench', text: 'Организация диагностики и ремонта' },
  { icon: 'fa-gears', text: 'Помощь с заменой необходимых комплектующих' },
  { icon: 'fa-handshake', text: 'Взаимодействие с производителем или поставщиком по гарантийному случаю' },
];

const WarrantyPage: React.FC = () => {
  useEffect(
    () =>
      applySeo({
        title: 'Гарантия и сервис на сантехнику | Bathroom Design Астана',
        description:
          'Гарантия и сервисная поддержка Bathroom Design: консультация по эксплуатации, диагностика и ремонт, замена комплектующих, сопровождение гарантийного обращения к производителю.',
      }),
    []
  );

  return (
    <div className="pb-24">
      {/* Hero - same navy treatment as the partner directories. */}
      <div className="relative overflow-hidden bg-[#1D2B49] py-16 md:py-24">
        <img
          src="/assets/hero/hero-bg.webp"
          alt=""
          aria-hidden="true"
          loading="eager"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-[#1D2B49]/75" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0f1729]/60 via-transparent to-[#0f1729]/60" />
        <div className="container relative mx-auto px-6 text-center">
          <Reveal>
            <div className="text-xs font-black uppercase tracking-[0.3em] text-[#CEA549]">Поддержка</div>
            <h1 className="mt-3 font-display italic text-4xl leading-[1.1] text-white drop-shadow-lg sm:text-5xl md:text-6xl">
              Гарантия и сервис
            </h1>
            <div className="mx-auto mt-5 h-px w-16 bg-[#CEA549]/50" />
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-white/75 md:text-base">
              Мы отвечаем за сантехнику, которую предлагаем нашим клиентам.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="container mx-auto px-6">
        <Reveal className="mx-auto mt-16 max-w-3xl text-center">
          <p className="text-lg leading-relaxed text-gray-600 md:text-xl">
            Наша работа не заканчивается после покупки. Если в процессе эксплуатации возникнет гарантийный случай,
            наша сервисная служба поможет разобраться в ситуации и найти решение.
          </p>
        </Reveal>

        <div className="mx-auto mt-16 max-w-5xl">
          <Reveal>
            <h2 className="text-center font-heading text-2xl font-bold text-[#1D2B49] md:text-3xl">
              Что входит в сервисную поддержку
            </h2>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {SUPPORT_ITEMS.map((item, idx) => (
              <Reveal
                key={item.text}
                index={idx}
                className="flex items-start gap-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
              >
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#1D2B49]/[0.06] text-[#1D2B49]">
                  <i className={`fas ${item.icon}`}></i>
                </span>
                <span className="pt-2.5 text-sm leading-relaxed text-gray-600">{item.text}</span>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-5xl grid-cols-1 gap-8 lg:grid-cols-2">
          <Reveal className="rounded-3xl bg-[#1D2B49] p-8 text-white md:p-10">
            <h2 className="font-heading text-2xl font-bold">Как обратиться по гарантии?</h2>
            <div className="mt-6 space-y-5">
              <div className="flex gap-4">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#CEA549] text-sm font-black">
                  1
                </span>
                <p className="text-sm leading-relaxed text-white/80">
                  Свяжитесь с нами и предоставьте информацию о приобретённом товаре, описание проблемы, а при
                  необходимости — фото или видео.
                </p>
              </div>
              <div className="flex gap-4">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#CEA549] text-sm font-black">
                  2
                </span>
                <p className="text-sm leading-relaxed text-white/80">
                  Мы рассмотрим обращение и подскажем дальнейшие действия.
                </p>
              </div>
            </div>

            <div className="mt-8 border-t border-white/10 pt-6">
              <p className="font-display text-xl italic leading-snug text-[#CEA549]">
                Мы не просто продаём сантехнику — мы остаёмся на связи и после покупки.
              </p>
            </div>

            <Link
              to="/catalog"
              className="mt-8 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white underline decoration-[#CEA549] decoration-2 underline-offset-4 transition-colors hover:text-[#CEA549]"
            >
              Перейти в каталог
              <i className="fas fa-arrow-right text-[10px]"></i>
            </Link>
          </Reveal>

          <Reveal className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm md:p-10">
            <h2 className="font-heading text-2xl font-bold text-[#1D2B49]">Оставить обращение</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              Опишите товар и проблему — сервисная служба свяжется с вами.
            </p>
            <div className="mt-6">
              <LeadForm initialMessage="Гарантийное обращение. Товар: ... Описание проблемы: ..." submitLabel="Отправить обращение" />
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
};

export default WarrantyPage;
