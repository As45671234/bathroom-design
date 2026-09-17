import React from 'react';
import { Link } from 'react-router-dom';
import { Product } from '../types';
import {
  discountPercent,
  displayPrice,
  formatPrice,
  getProductColor,
  getProductImages,
  productPath,
} from '../utils/product';

interface ProductCardProps {
  product: Product;
  onAddToCart: (p: Product) => void;
}

/**
 * The one product card used by the catalog, visual search and the homepage
 * showcases. The whole card is clickable through a stretched overlay link —
 * that keeps the markup valid (no <button> nested inside an <a>) while the
 * "В корзину" button still gets its own click target on top of it.
 */
const ProductCard: React.FC<ProductCardProps> = ({ product, onAddToCart }) => {
  const images = getProductImages(product);
  const color = getProductColor(product);
  const discount = discountPercent(product);

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm transition-all hover:border-gray-200 hover:shadow-xl focus-within:ring-2 focus-within:ring-[#CEA549]">
      <Link
        to={productPath(product)}
        className="absolute inset-0 z-10 rounded-3xl outline-none"
        aria-label={product.name}
      />

      <div className="relative h-56 overflow-hidden bg-gray-50">
        {images[0] ? (
          <>
            <img
              src={images[0]}
              alt={product.name}
              loading="lazy"
              className={`h-full w-full object-contain p-4 transition-all duration-500 ${
                images[1] ? 'group-hover:opacity-0' : 'group-hover:scale-105'
              }`}
            />
            {images[1] ? (
              <img
                src={images[1]}
                alt=""
                loading="lazy"
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-contain p-4 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              />
            ) : null}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-gray-300">
            <i className="fas fa-bath"></i>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-2">
          {product.brand ? (
            <span className="rounded-full bg-[#1D2B49] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white">
              {product.brand}
            </span>
          ) : (
            <span />
          )}
          {discount > 0 ? (
            <span className="rounded-full bg-[#CEA549] px-3 py-1.5 text-[10px] font-bold text-white">−{discount}%</span>
          ) : null}
        </div>

        {/* Shown only when it changes a buying decision — today every product in
            the catalog is in stock, so a green "В наличии" on all of them would
            be wallpaper rather than information. */}
        {!product.inStock ? (
          <span className="pointer-events-none absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-700">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            Под заказ
          </span>
        ) : null}
      </div>

      <div className="flex flex-grow flex-col p-5">
        <h3 className="mb-1 line-clamp-2 font-heading text-base font-semibold leading-snug text-[#111827]">
          {product.name}
        </h3>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {product.subcategory || product.collection ? (
            <p className="text-xs text-gray-400">
              {[product.subcategory, product.collection].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {color ? (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1D2B49]">
              {color}
            </span>
          ) : null}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-gray-50 pt-4">
          <div className="min-w-0">
            <div className="font-heading text-xl font-semibold text-[#1D2B49]">{displayPrice(product)}</div>
            {product.prices.oldPrice ? (
              <div className="text-xs text-gray-400 line-through">{formatPrice(product.prices.oldPrice)}</div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddToCart(product);
            }}
            aria-label={`Добавить «${product.name}» в корзину`}
            className="relative z-20 inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-[#1D2B49] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#CEA549] hover:text-[#1D2B49]"
          >
            <i className="fas fa-cart-plus"></i>
            <span className="hidden sm:inline">В корзину</span>
          </button>
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
