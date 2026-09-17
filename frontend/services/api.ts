
export function getAdminToken() {
  return localStorage.getItem('bathroomdesign_admin_token') || '';
}

export function setAdminToken(token: string) {
  localStorage.setItem('bathroomdesign_admin_token', token);
}

export function clearAdminToken() {
  localStorage.removeItem('bathroomdesign_admin_token');
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const hasBody = options.body !== undefined && options.body !== null;

  if (hasBody && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.headers) {
    Object.assign(headers, options.headers as any);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    let msg = 'Ошибка запроса';
    try {
      const data = await res.json();
      msg = data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

export async function fetchCatalog() {
  return request<{ categories: any[] }>('/api/catalog');
}

export interface VisualSearchMatch {
  id: string;
  name: string;
  brand: string;
  collection: string;
  sku: string;
  image: string;
  images: string[];
  category_id: string;
  category_title: string;
  attrs: Record<string, string>;
  prices: { retail?: number; oldPrice?: number; note?: string };
  score: number;
}

export interface VisualSearchComponent {
  type: string;
  description: string;
  category_id: string | null;
  matches: VisualSearchMatch[];
}

export async function visualSearch(file: File) {
  const formData = new FormData();
  formData.append('image', file);
  return request<{ components: VisualSearchComponent[] }>('/api/visual-search', {
    method: 'POST',
    body: formData,
  });
}

export async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function adminLogin(password: string) {
  return request<{ token: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function fetchAdminCatalog(token: string) {
  return request<{ categories: any[] }>('/api/admin/catalog', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminFetchCategories(token: string) {
  return request<{ categories: any[] }>('/api/admin/categories', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminPatchCategory(token: string, id: string, patch: any) {
  return request<{ ok: boolean; category: any }>(`/api/admin/categories/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
}

export async function adminCreateCategory(token: string, body: any) {
  return request<{ ok: boolean; category: any }>(`/api/admin/categories`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function adminDeleteCategory(token: string, id: string, removeProducts = false) {
  const q = removeProducts ? '?removeProducts=true' : '';
  return request<{ ok: boolean; deleted: { categoryMeta: number; products: number } }>(`/api/admin/categories/${id}${q}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminPatchProduct(token: string, id: string, patch: any) {
  return request<{ product: any }>(`/api/admin/products/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteProduct(token: string, id: string) {
  return request<{ ok: boolean }>(`/api/admin/products/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminCreateProduct(token: string, body: any) {
  return request<{ product: any }>(`/api/admin/products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function sendLead(data: { name?: string; phone: string; email: string; message?: string; }) {
  return request<{ ok: boolean; id: string }>(`/api/leads`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function sendOrder(data: any) {
  return request<{ ok: boolean; id: string }>(`/api/orders`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function adminFetchOrders(token: string, params: { page?: number; limit?: number; status?: string; sortBy?: string; sortDir?: string } = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.status) q.set('status', params.status);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortDir) q.set('sortDir', params.sortDir);

  const qs = q.toString();
  return request<{ page: number; limit: number; total: number; items: any[] }>(`/api/admin/orders${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminFetchOrder(token: string, id: string) {
  return request<{ order: any }>(`/api/admin/orders/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminPatchOrder(token: string, id: string, status: string) {
  return request<{ ok: boolean; status: string }>(`/api/admin/orders/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
}

export async function adminDeleteOrder(token: string, id: string) {
  return request<{ ok: boolean }>(`/api/admin/orders/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminExportOrder(token: string, id: string) {
  const res = await fetch(`/api/admin/orders/${id}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    let msg = 'Ошибка экспорта';
    try {
      const data = await res.json();
      msg = data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  return blob;
}

// --------------------
// Leads (Admin)
// --------------------
export async function adminFetchLeads(token: string, params: { page?: number; limit?: number; status?: string; sortDir?: string } = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.status) q.set('status', params.status);
  if (params.sortDir) q.set('sortDir', params.sortDir);
  const qs = q.toString();

  return request<{ page: number; limit: number; total: number; items: any[] }>(`/api/admin/leads${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminFetchLead(token: string, id: string) {
  return request<{ lead: any }>(`/api/admin/leads/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminPatchLead(token: string, id: string, status: string) {
  return request<{ ok: boolean; status: string }>(`/api/admin/leads/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
}

export async function adminDeleteLead(token: string, id: string) {
  return request<{ ok: boolean }>(`/api/admin/leads/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type NoPhotoReport = {
  count: number;
  samples: { id: string; name: string; brand: string; category_title: string; sku: string }[];
  byCategory: { category_title: string; count: number }[];
};

export async function adminCountProductsWithoutPhoto(token: string) {
  return request<NoPhotoReport>('/api/admin/products/no-photo', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminDeleteProductsWithoutPhoto(token: string, expectedCount: number) {
  return request<{ ok: boolean; deleted: number }>(
    `/api/admin/products/no-photo?expectedCount=${expectedCount}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

export async function adminPurgeAll(token: string, purgePassword: string) {
  return request<{ ok: boolean; deleted: { products: number; categories: number; orders: number; leads: number } }>(`/api/admin/purge-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirmText: 'DELETE_ALL', purgePassword }),
  });
}

// --------------------
// Designers
// --------------------
export async function fetchDesigners() {
  return request<{ designers: any[] }>('/api/designers');
}

export async function adminFetchDesigners(token: string) {
  return request<{ designers: any[] }>('/api/admin/designers', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminCreateDesigner(token: string, body: any) {
  return request<{ designer: any }>('/api/admin/designers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function adminPatchDesigner(token: string, id: string, patch: any) {
  return request<{ designer: any }>(`/api/admin/designers/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteDesigner(token: string, id: string) {
  return request<{ ok: boolean }>(`/api/admin/designers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchSiteSettings() {
  return request<{ ok: boolean; settings: any }>('/api/site-settings');
}

export async function adminGetSiteSettings(token: string) {
  return request<{ ok: boolean; settings: any }>('/api/admin/site-settings', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminSaveSiteSettings(token: string, settings: any) {
  return request<{ ok: boolean; settings: any }>('/api/admin/site-settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(settings),
  });
}

export async function adminUploadProductImage(token: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch('/api/admin/upload/product-image', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });

  if (!res.ok) {
    let msg = 'Ошибка загрузки изображения';
    try {
      const data = await res.json();
      msg = data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json() as Promise<{ ok: boolean; imageUrl: string }>;
}

export async function adminUploadImage(token: string, file: File): Promise<string> {
  const data = await adminUploadProductImage(token, file);
  return data.imageUrl;
}

export async function adminUploadCategoryVideo(token: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch('/api/admin/upload/category-video', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });

  if (!res.ok) {
    let msg = `Ошибка загрузки видео (${res.status})`;
    try {
      const data = await res.json();
      msg = data?.details || data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  return data as Promise<{ ok: boolean; videoUrl: string }>;
}

export async function adminDownloadImportTemplate(token: string) {
  const res = await fetch('/api/admin/import/excel/template', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    let msg = 'Ошибка скачивания шаблона';
    try {
      const data = await res.json();
      msg = data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.blob();
}

// --------------------
// Excel import (chunked upload targeting a category)
// --------------------
export async function adminImportExcel(token: string, file: File, category: string, categoryTitle: string, brand?: string) {
  const CHUNK_SIZE = 512 * 1024;

  const parseImportError = async (res: Response) => {
    let msg = 'Ошибка импорта';
    try {
      const data = await res.json();
      msg = data?.details || data?.error || msg;
    } catch {
      try {
        const raw = await res.text();
        const compact = String(raw || '').replace(/\s+/g, ' ').trim();
        const hint = compact ? `: ${compact.slice(0, 180)}` : '';
        msg = `Ошибка импорта (HTTP ${res.status})${hint}`;
      } catch {
        msg = `Ошибка импорта (HTTP ${res.status})`;
      }
    }
    return msg;
  };

  const initRes = await fetch('/api/admin/import/excel/chunk/init', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!initRes.ok) {
    throw new Error(await parseImportError(initRes));
  }

  const initData = await initRes.json() as { ok: boolean; uploadId: string };
  const uploadId = String(initData?.uploadId || '');
  if (!uploadId) throw new Error('Ошибка импорта: не удалось создать сессию загрузки');

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  for (let index = 0; index < totalChunks; index++) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const chunkBlob = file.slice(start, end);

    const fd = new FormData();
    fd.append('chunk', chunkBlob, `${file.name}.part${index}`);
    fd.append('index', String(index));

    const chunkRes = await fetch(`/api/admin/import/excel/chunk/${encodeURIComponent(uploadId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });

    if (!chunkRes.ok) {
      throw new Error(await parseImportError(chunkRes));
    }
  }

  const completeRes = await fetch(`/api/admin/import/excel/chunk/${encodeURIComponent(uploadId)}/complete`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ category, categoryTitle, filename: file.name, brand: brand || '' }),
  });

  if (!completeRes.ok) {
    throw new Error(await parseImportError(completeRes));
  }

  return completeRes.json() as Promise<{
    ok: boolean; inserted: number; updated: number; skipped: number;
    totalParsed: number; category: { id: string; title: string }; durationMs: number;
  }>;
}
