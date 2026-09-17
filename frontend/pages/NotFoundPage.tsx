import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { applySeo } from '../utils/seo';

/** Catch-all route — previously an unknown URL rendered an empty <main>. */
const NotFoundPage: React.FC = () => {
  useEffect(
    () =>
      applySeo({
        title: 'Страница не найдена | Bathroom Design',
        description: 'Такой страницы нет. Вернитесь на главную или откройте каталог сантехники Bathroom Design.',
      }),
    []
  );

  return (
    <div className="container mx-auto px-6 py-24 text-center">
      <div className="font-display text-7xl italic text-[#CEA549]">404</div>
      <h1 className="mt-4 font-heading text-3xl font-semibold text-[#1D2B49]">Страница не найдена</h1>
      <p className="mx-auto mt-3 max-w-md text-gray-500">
        Возможно, ссылка устарела или в адресе опечатка. Попробуйте начать с каталога.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          to="/catalog"
          className="inline-flex rounded-full bg-[#1D2B49] px-8 py-3.5 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
        >
          В каталог
        </Link>
        <Link
          to="/"
          className="inline-flex rounded-full border border-gray-200 bg-white px-8 py-3.5 font-heading font-semibold text-[#1D2B49] transition-all hover:border-[#CEA549]"
        >
          На главную
        </Link>
      </div>
    </div>
  );
};

export default NotFoundPage;
