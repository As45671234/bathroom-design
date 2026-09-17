import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CartItem } from '../types';
import { formatPrice, getProductImages, productPath } from '../utils/product';

interface CartPageProps {
  cart: CartItem[];
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, delta: number) => void;
  clearCart: () => void;
  /** Shop phone from site settings — doubles as the WhatsApp the order goes to. */
  phone?: string;
}

const CartPage: React.FC<CartPageProps> = ({ cart, removeFromCart, updateQuantity, clearCart, phone }) => {
  const total = cart.reduce((sum, item) => sum + (item.prices.retail || 0) * item.quantity, 0);
  const totalUnits = cart.reduce((sum, item) => sum + item.quantity, 0);
  const itemsWithoutPrice = cart.filter((item) => !item.prices.retail).length;
  // Part of the catalog is priced on request, so a cart of only such items has a
  // real total of 0 — showing "0 ₸" would read as free rather than as unknown.
  const totalLabel = total > 0 ? formatPrice(total) : 'По запросу';
  // With the whole catalog priced on request, the cart is a request list rather
  // than a bill — say that once instead of counting priceless items.
  const allPricesOnRequest = itemsWithoutPrice === cart.length;

  // Lifts the floating WhatsApp button above the sticky total bar.
  useEffect(() => {
    if (cart.length === 0) return;
    document.body.setAttribute('data-buybar', '1');
    return () => document.body.removeAttribute('data-buybar');
  }, [cart.length]);

  /**
   * WhatsApp can only carry text, so each item ships with a link to its page —
   * that's how the manager gets to the photo. Number comes from site settings
   * (same one shown in the header); the env var is a fallback for local runs.
   */
  const whatsappUrl = useMemo(() => {
    const target = String(phone || import.meta.env.VITE_WHATSAPP_PHONE || '').replace(/\D/g, '');
    if (!target || cart.length === 0) return '';

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const lines = cart.map((item, i) => {
      const head = `${i + 1}. ${item.name}${item.sku ? ` (арт. ${item.sku})` : ''}`;
      const price = item.prices.retail
        ? `${item.quantity} ${item.unit} × ${formatPrice(item.prices.retail)}`
        : `${item.quantity} ${item.unit} — цена по запросу`;
      return `${head}\n   ${price}\n   ${origin}${productPath(item)}`;
    });

    // Blank strings here are deliberate paragraph breaks — don't filter them out.
    const parts = [
      'Здравствуйте! Хочу оставить заявку на эти товары:',
      '',
      lines.join('\n\n'),
      '',
      total > 0 ? `Итого: ${formatPrice(total)}` : 'Цену прошу уточнить.',
    ];

    return `https://wa.me/${target}?text=${encodeURIComponent(parts.join('\n'))}`;
  }, [cart, total, phone]);

  if (cart.length === 0) {
    return (
      <div className="container mx-auto px-6 py-24 text-center">
        <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gray-50 text-3xl text-gray-200">
          <i className="fas fa-shopping-basket"></i>
        </div>
        <h1 className="mb-4 font-heading text-3xl font-semibold text-[#1D2B49]">Корзина пуста</h1>
        <p className="mx-auto mb-10 max-w-md text-gray-500">Добавьте товары из каталога, чтобы оформить заказ.</p>
        <Link
          to="/catalog"
          className="inline-flex rounded-full bg-[#1D2B49] px-10 py-4 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
        >
          Перейти в каталог
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-28 lg:pb-0">
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-10">
        <nav aria-label="Хлебные крошки" className="mb-5 flex items-center gap-2 text-xs text-gray-400">
          <Link to="/" className="transition-colors hover:text-[#CEA549]">Главная</Link>
          <span>/</span>
          <Link to="/catalog" className="transition-colors hover:text-[#CEA549]">Каталог</Link>
          <span>/</span>
          <span className="font-semibold text-[#1D2B49]">Корзина</span>
        </nav>

        <h1 className="mb-6 font-heading text-3xl font-semibold text-[#1D2B49] sm:mb-10 sm:text-4xl">
          Корзина
          <span className="ml-3 text-lg font-normal text-gray-400">
            {totalUnits} {totalUnits === 1 ? 'товар' : totalUnits < 5 ? 'товара' : 'товаров'}
          </span>
        </h1>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:gap-10">
          <div className="space-y-3 sm:space-y-4 lg:col-span-2">
            {cart.map((item) => {
              const image = getProductImages(item)[0];
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:gap-6 sm:p-6"
                >
                  <Link
                    to={productPath(item)}
                    className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gray-50 sm:h-24 sm:w-24"
                  >
                    {image ? (
                      <img src={image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <i className="fas fa-bath text-2xl text-gray-300"></i>
                    )}
                  </Link>

                  <div className="min-w-0 flex-grow">
                    {item.brand ? (
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#CEA549]">{item.brand}</div>
                    ) : null}
                    <Link
                      to={productPath(item)}
                      className="line-clamp-2 font-heading text-base font-semibold text-[#1D2B49] transition-colors hover:text-[#CEA549] sm:text-lg"
                    >
                      {item.name}
                    </Link>
                    {item.sku ? <div className="mt-1 text-[11px] text-gray-400">Арт: {item.sku}</div> : null}
                    <div className="mt-1 text-sm text-gray-400">
                      {item.prices.retail
                        ? `${formatPrice(item.prices.retail)} / ${item.unit}`
                        : 'Цена по запросу'}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-start rounded-2xl bg-gray-50 p-2 sm:self-auto">
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      aria-label="Уменьшить количество"
                      className="h-9 w-9 rounded-xl text-[#1D2B49] shadow-sm transition-all hover:bg-white sm:h-10 sm:w-10"
                    >
                      <i className="fas fa-minus"></i>
                    </button>
                    <span className="w-8 text-center font-bold text-[#1D2B49]">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      aria-label="Увеличить количество"
                      className="h-9 w-9 rounded-xl text-[#1D2B49] shadow-sm transition-all hover:bg-white sm:h-10 sm:w-10"
                    >
                      <i className="fas fa-plus"></i>
                    </button>
                  </div>

                  <div className="ml-auto min-w-[96px] text-right sm:min-w-[120px]">
                    <div className="font-heading text-xl font-semibold text-[#1D2B49] sm:text-2xl">
                      {item.prices.retail ? formatPrice(item.prices.retail * item.quantity) : '—'}
                    </div>
                  </div>

                  <button
                    onClick={() => removeFromCart(item.id)}
                    aria-label={`Удалить «${item.name}» из корзины`}
                    className="p-2 text-gray-300 transition-colors hover:text-red-500"
                  >
                    <i className="fas fa-trash-alt"></i>
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={clearCart}
              className="text-sm font-semibold text-gray-400 transition-colors hover:text-red-500"
            >
              Очистить корзину
            </button>
          </div>

          <div className="sticky top-32 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl sm:p-8">
            <h2 className="mb-6 font-heading text-2xl font-semibold text-[#1D2B49]">Итого</h2>

            <div className="mb-6 flex justify-between text-gray-500">
              <span>Товары ({totalUnits} шт.)</span>
              <span className="font-bold text-[#1D2B49]">{allPricesOnRequest ? '—' : totalLabel}</span>
            </div>

            {itemsWithoutPrice > 0 ? (
              <div className="mb-5 rounded-2xl bg-[#CEA549]/10 p-4 text-xs leading-relaxed text-[#1D2B49]">
                <i className="fas fa-circle-info mr-1.5 text-[#CEA549]"></i>
                {allPricesOnRequest
                  ? 'Это заявка, а не оплата. Менеджер подтвердит наличие, назовёт цену и стоимость доставки.'
                  : `На ${itemsWithoutPrice} ${itemsWithoutPrice === 1 ? 'товар' : 'товара(-ов)'} цена указана по запросу — менеджер сообщит её при подтверждении.`}
              </div>
            ) : null}

            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2.5 rounded-full bg-[#1D2B49] py-4 font-heading font-semibold text-white transition-all hover:bg-[#152036]"
              >
                <i className="fas fa-paper-plane text-base"></i>
                Оставить заявку
              </a>
            ) : (
              <div className="rounded-2xl bg-red-50 p-4 text-xs text-red-500">
                Номер WhatsApp не указан в настройках сайта — заявку отправить некуда.
              </div>
            )}

            <p className="mt-3 text-center text-xs text-gray-400">
              Откроется WhatsApp со списком товаров — останется только нажать «Отправить».
            </p>

            <div className="mt-6 text-center">
              <Link to="/catalog" className="text-sm font-bold text-gray-400 hover:underline">
                Вернуться к покупкам
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky total on phones — the summary card sits far below the item list */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-100 bg-white/95 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-shrink">
            <div className="truncate font-heading text-lg font-semibold text-[#1D2B49]">
              {allPricesOnRequest ? `${totalUnits} шт.` : totalLabel}
            </div>
            <div className="text-[11px] text-gray-400">
              {allPricesOnRequest ? 'цену уточним' : `${totalUnits} шт.`}
            </div>
          </div>
          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-grow items-center justify-center gap-2 rounded-full bg-[#1D2B49] px-5 py-3 font-heading text-sm font-semibold text-white transition-all hover:bg-[#152036]"
            >
              <i className="fas fa-paper-plane text-sm"></i>
              Оставить заявку
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default CartPage;
