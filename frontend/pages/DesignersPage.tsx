import React from 'react';
import PartnersDirectory, { PartnersDirectoryConfig, pluralize } from '../components/PartnersDirectory';

const designersConfig: PartnersDirectoryConfig = {
  kind: 'designers',
  seoTitle: 'Рекомендуемые дизайнеры | Bathroom Design',
  seoDescription:
    'Дизайнеры интерьера ванных комнат, с которыми сотрудничает Bathroom Design — портфолио, контакты и специальные условия на комплектацию сантехники.',
  eyebrow: 'Партнёры',
  heading: 'Рекомендуемые дизайнеры',
  intro:
    'Сильные дизайнеры интерьера Казахстана, с которыми мы сотрудничаем. Закажите проект у партнёра — и получите скидку на комплектацию сантехники в BATHROOM design.',
  tags: ['Красивый проект', 'Профессиональная комплектация', 'Выгодные условия'],
  heroImage: '/assets/hero/designers-bg.webp',
  icon: 'fa-user-tie',
  countBadge: (n) =>
    `${n} ${pluralize(n, ['дизайнер', 'дизайнера', 'дизайнеров'])} ${pluralize(n, ['готов', 'готовы', 'готовы'])} помочь`,
  emptyText: 'Пока никого не добавили — загляните позже.',
  errorText: 'Не удалось загрузить список дизайнеров. Попробуйте обновить страницу.',
  fallbackBio: 'Дизайнер команды Bathroom Design.',
  ctaLabel: 'Записаться на консультацию',
  consultGreeting: 'Здравствуйте! Хочу проконсультироваться по ванной комнате.',
  leadTitle: 'Заявка на консультацию',
  leadSubjectLabel: 'Дизайнер',
  leadInitialMessage: (name) => `Хочу проконсультироваться с дизайнером: ${name}`,
};

const DesignersPage: React.FC = () => <PartnersDirectory config={designersConfig} />;

export default DesignersPage;
