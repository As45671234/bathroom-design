
export interface ProductPrice {
  retail?: number;
  oldPrice?: number;
  wholesale?: number;
  note?: string;
}

export interface ProductAttrs {
  [key: string]: any;
}

export interface Product {
  id: string;
  name: string;
  brand?: string;
  collection?: string;
  subcategory?: string;
  unit: string;
  sku?: string;
  image?: string;
  images?: string[];
  description?: string;
  stockQty?: number;
  prices: ProductPrice;
  attrs: ProductAttrs;
  category_id: string;
  inStock: boolean;
}

export interface Category {
  id: string;
  title: string;
  items: Product[];
  image?: string;
  styleVariant?: 1 | 2;
  videoUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  productsCount?: number;
}

export interface CartItem extends Product {
  quantity: number;
}

/** Load state of the one-shot catalog fetch, shared by every page that lists products. */
export type CatalogStatus = 'loading' | 'ready' | 'error';

export interface OrderItem {
  productId?: string;
  name: string;
  sku?: string;
  unit?: string;
  image?: string;
  price?: number;
  quantity: number;
  lineTotal?: number;
}

export interface Order {
  id: string;
  customerName?: string;
  customerPhone: string;
  customerEmail: string;
  address?: string;
  comment?: string;
  deliveryMethod?: 'courier' | 'pickup' | 'transport_company';
  paymentMethod?: 'kaspi' | 'halyk' | 'cash';
  items: OrderItem[];
  total: number;
  createdAt?: string;
  status: 'new' | 'processing' | 'completed' | 'cancelled';
}

export interface Lead {
  id: string;
  name?: string;
  phone: string;
  email: string;
  message?: string;
  status: 'new' | 'processing' | 'done';
  createdAt?: string;
}

export interface AppState {
  categories: Category[];
  cart: CartItem[];
  orders: Order[];
}

export interface HeroSlide {
  title: string;
  subtitle: string;
  desc: string;
  img: string;
}

export interface AboutSlide {
  title: string;
  text: string;
  imageUrl: string;
  bullets: string[];
}

export interface HomepageProductSlideImage {
  id: string;
  image: string;
  title: string;
  description: string;
}

export interface HomepageImages {
  headerLogo: string;
  footerLogo: string;
  partnersBackground: string;
  productSlides: HomepageProductSlideImage[];
  partnerLogos: string[];
}

export interface ColorSwatch {
  code: string;
  title: string;
  image: string;
}

export interface Designer {
  id: string;
  name: string;
  position?: string;
  photo?: string;
  bio?: string;
  experienceYears?: number;
  phone?: string;
  email?: string;
  instagramUrl?: string;
  whatsappUrl?: string;
  portfolio?: string[];
  order?: number;
  active?: boolean;
}

export interface SiteSettings {
  phone: string;
  email: string;
  address: string;
  kaspiEnabled: boolean;
  kaspiUrl: string;
  halykEnabled: boolean;
  halykUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  heroSlides: HeroSlide[];
  aboutSlides: AboutSlide[];
  homepageImages: HomepageImages;
  colorSwatches: ColorSwatch[];
}
