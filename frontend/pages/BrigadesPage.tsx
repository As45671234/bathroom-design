import React from 'react';
import PartnersDirectory, { PartnersDirectoryConfig, pluralize } from '../components/PartnersDirectory';

const brigadesConfig: PartnersDirectoryConfig = {
  kind: 'brigades',
  seoTitle: 'Строительные бригады и мастера по монтажу сантехники | Bathroom Design',
  seoDescription:
    'Проверенные строительные бригады и мастера по установке сантехники в Алматы и Астане — опыт, примеры работ, контакты. Монтаж ванн, душевых, инсталляций и смесителей.',
  eyebrow: 'Партнёры',
  heading: 'Строительные бригады',
  intro:
    'Проверенные бригады и мастера, которые устанавливают сантехнику из нашего каталога. Опыт работы с инсталляциями, душевыми системами и встраиваемыми смесителями — монтаж без сюрпризов.',
  tags: ['Проверенные мастера', 'Опыт с нашей сантехникой', 'Аккуратный монтаж'],
  heroImage: '/assets/hero/hero-bg.webp',
  icon: 'fa-helmet-safety',
  countBadge: (n) =>
    `${n} ${pluralize(n, ['бригада', 'бригады', 'бригад'])} ${pluralize(n, ['готова', 'готовы', 'готовы'])} взяться за работу`,
  emptyText: 'Пока никого не добавили — загляните позже.',
  errorText: 'Не удалось загрузить список бригад. Попробуйте обновить страницу.',
  fallbackBio: 'Бригада-партнёр Bathroom Design.',
  ctaLabel: 'Обсудить монтаж',
  consultGreeting: 'Здравствуйте! Хочу обсудить монтаж сантехники.',
  leadTitle: 'Заявка на монтаж',
  leadSubjectLabel: 'Бригада',
  leadInitialMessage: (name) => `Хочу обсудить монтаж с бригадой: ${name}`,
};

const BrigadesPage: React.FC = () => <PartnersDirectory config={brigadesConfig} />;

export default BrigadesPage;
