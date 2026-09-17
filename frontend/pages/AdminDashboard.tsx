
import React, { useEffect, useMemo, useState } from 'react';
import { Category, HomepageImages, SiteSettings } from '../types';
import {
  getAdminToken, fetchAdminCatalog, adminImportExcel, adminPatchProduct, adminDeleteProduct,
  adminCreateProduct, fetchCatalog, adminFetchOrders, adminFetchOrder, adminPatchOrder,
  adminDeleteOrder, adminExportOrder, adminFetchLeads, adminFetchLead, adminPatchLead,
  adminDeleteLead, adminUploadProductImage, adminPatchCategory, adminCreateCategory,
  adminDeleteCategory, adminPurgeAll, adminGetSiteSettings, adminSaveSiteSettings, adminDownloadImportTemplate,
  adminUploadImage, adminUploadCategoryVideo, adminFetchCategories,
  adminCountProductsWithoutPhoto, adminDeleteProductsWithoutPhoto,
  adminFetchDesigners, adminCreateDesigner, adminPatchDesigner, adminDeleteDesigner,
} from '../services/api';
import { normalizeAssetUrl } from '../utils/assetUrl';

const DEFAULT_SITE_SETTINGS: SiteSettings = {
  phone: '+7 700 000 00 00',
  email: 'info@bathroomdesign.kz',
  address: 'г. Алматы',
  kaspiEnabled: true,
  kaspiUrl: '',
  halykEnabled: false,
  halykUrl: '',
  instagramUrl: '',
  facebookUrl: '',
  heroSlides: [],
  aboutSlides: [],
  homepageImages: {
    headerLogo: '',
    footerLogo: '',
    partnersBackground: '',
    productSlides: [],
    partnerLogos: [],
  },
  colorSwatches: [],
};

const mergeSiteSettings = (raw?: Partial<SiteSettings> | null): SiteSettings => {
  const src = raw || {};
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...src,
    heroSlides: Array.isArray(src.heroSlides) ? src.heroSlides : [],
    aboutSlides: Array.isArray(src.aboutSlides) ? src.aboutSlides : [],
    homepageImages: {
      ...DEFAULT_SITE_SETTINGS.homepageImages,
      ...(src.homepageImages || {}),
      productSlides: Array.isArray(src.homepageImages?.productSlides) ? src.homepageImages!.productSlides : [],
      partnerLogos: Array.isArray(src.homepageImages?.partnerLogos) ? src.homepageImages!.partnerLogos : [],
    },
    colorSwatches: Array.isArray(src.colorSwatches) ? src.colorSwatches : [],
  };
};

interface AdminDashboardProps {
  categories: Category[];
  setCategories: (cats: Category[]) => void;
  onLogout: () => void;
}

type Tab = 'inventory' | 'import' | 'orders' | 'leads' | 'categories' | 'designers' | 'settings';

interface DesignerDraft {
  name: string;
  position: string;
  photo: string;
  bio: string;
  experienceYears: string;
  phone: string;
  email: string;
  instagramUrl: string;
  whatsappUrl: string;
  portfolio: string[];
  active: boolean;
}

const emptyDesignerDraft: DesignerDraft = {
  name: '', position: '', photo: '', bio: '', experienceYears: '',
  phone: '', email: '', instagramUrl: '', whatsappUrl: '', portfolio: [], active: true,
};

const parseNum = (v: string) => {
  const s = String(v || '').trim();
  if (!s) return undefined;
  const n = Number(s.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

const attrsToEditorText = (attrs: any) =>
  Object.entries(attrs || {})
    .map(([k, v]) => [String(k || ''), String(v ?? '').trim()] as const)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

const editorTextToAttrs = (text: string) => {
  const attrs: Record<string, string> = {};
  String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k && v) attrs[k] = v;
      }
    });
  return attrs;
};

const emptyProductForm = {
  category_id: '',
  category_title: '',
  name: '',
  brand: '',
  collection: '',
  subcategory: '',
  unit: 'шт',
  sku: '',
  images: ['', '', ''],
  description: '',
  stockQty: '',
  retail: '',
  oldPrice: '',
  wholesale: '',
  note: '',
  attrsText: '',
  inStock: true,
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ setCategories, onLogout }) => {
  const token = getAdminToken();
  const [activeTab, setActiveTab] = useState<Tab>('inventory');
  const [adminCategories, setAdminCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [invPage, setInvPage] = useState(1);
  const INV_PAGE_SIZE = 30;

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [addForm, setAddForm] = useState({ ...emptyProductForm });
  const [editForm, setEditForm] = useState({ ...emptyProductForm });
  const [addUseNewCategory, setAddUseNewCategory] = useState(false);
  const [addImageUploading, setAddImageUploading] = useState(false);
  const [editImageUploading, setEditImageUploading] = useState(false);

  const [isPurgingAll, setIsPurgingAll] = useState(false);
  const [isDeletingNoPhoto, setIsDeletingNoPhoto] = useState(false);

  // Import
  const [importCategory, setImportCategory] = useState('');
  const [importNewCategoryTitle, setImportNewCategoryTitle] = useState('');
  const [importBrand, setImportBrand] = useState('');
  const [importNewBrandTitle, setImportNewBrandTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ type: 'success' | 'error'; title: string; details: string } | null>(null);

  // Categories tab
  const [newCategoryForm, setNewCategoryForm] = useState({ title: '', styleVariant: 1 as 1 | 2 });
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, { title: string; styleVariant: 1 | 2; videoUrl: string; image: string; seoTitle: string; seoDescription: string; seoKeywords: string }>>({});
  const [categorySaving, setCategorySaving] = useState<Record<string, boolean>>({});
  const [categoryDeleting, setCategoryDeleting] = useState<Record<string, boolean>>({});
  const [categoryVideoUploading, setCategoryVideoUploading] = useState<Record<string, boolean>>({});
  const [categoryImageUploading, setCategoryImageUploading] = useState<Record<string, boolean>>({});

  // Designers tab
  const [designers, setDesigners] = useState<any[]>([]);
  const [designersLoaded, setDesignersLoaded] = useState(false);
  const [newDesignerName, setNewDesignerName] = useState('');
  const [creatingDesigner, setCreatingDesigner] = useState(false);
  const [designerDrafts, setDesignerDrafts] = useState<Record<string, DesignerDraft>>({});
  const [designerSaving, setDesignerSaving] = useState<Record<string, boolean>>({});
  const [designerDeleting, setDesignerDeleting] = useState<Record<string, boolean>>({});
  const [designerPhotoUploading, setDesignerPhotoUploading] = useState<Record<string, boolean>>({});
  const [designerPortfolioUploading, setDesignerPortfolioUploading] = useState<Record<string, boolean>>({});

  // Orders
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(1);
  const ordersLimit = 25;
  const [ordersStatus, setOrdersStatus] = useState('');
  const [isOrderOpen, setIsOrderOpen] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [activeOrder, setActiveOrder] = useState<any | null>(null);
  const [deleteOrderConfirmId, setDeleteOrderConfirmId] = useState('');

  // Leads
  const [leads, setLeads] = useState<any[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(1);
  const leadsLimit = 25;
  const [leadsStatus, setLeadsStatus] = useState('');
  const [isLeadOpen, setIsLeadOpen] = useState(false);
  const [leadLoading, setLeadLoading] = useState(false);
  const [activeLead, setActiveLead] = useState<any | null>(null);
  const [deleteLeadConfirmId, setDeleteLeadConfirmId] = useState('');

  // Site settings
  const [siteForm, setSiteForm] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const refreshAdmin = async () => {
    const [catalogData, metaData] = await Promise.all([
      fetchAdminCatalog(token),
      adminFetchCategories(token).catch(() => ({ categories: [] as any[] })),
    ]);
    const metaMap = new Map((metaData.categories || []).map((c: any) => [String(c.id || ''), c]));
    const merged = (catalogData.categories || []).map((cat: any) => {
      const meta = metaMap.get(String(cat.id || ''));
      return meta ? { ...cat, productsCount: cat.items?.length || meta.productsCount || 0 } : cat;
    });
    for (const [id, meta] of metaMap.entries()) {
      if (merged.some((c: any) => String(c.id || '') === id)) continue;
      merged.push({ id, title: meta.title || id, items: [], image: meta.image || '', styleVariant: meta.styleVariant || 1, videoUrl: meta.videoUrl || '', seoTitle: meta.seoTitle || '', seoDescription: meta.seoDescription || '', seoKeywords: meta.seoKeywords || '', productsCount: meta.productsCount || 0 });
    }
    setAdminCategories(merged as any);
  };

  const refreshPublic = async () => {
    const data = await fetchCatalog();
    setCategories(data.categories as any);
  };

  const refreshAll = async () => {
    await refreshAdmin();
    try { await refreshPublic(); } catch {}
  };

  const loadSiteSettings = async () => {
    setSettingsLoading(true);
    try {
      const data = await adminGetSiteSettings(token);
      setSiteForm(mergeSiteSettings(data?.settings || {}));
    } catch (e) {
      console.error(e);
    } finally {
      setSettingsLoading(false);
    }
  };

  const loadOrders = async (page = ordersPage) => {
    const data = await adminFetchOrders(token, { page, limit: ordersLimit, status: ordersStatus || undefined });
    setOrders(data.items || []);
    setOrdersTotal(Number(data.total || 0));
    setOrdersPage(Number(data.page || page));
  };

  const loadLeads = async (page = leadsPage) => {
    const data = await adminFetchLeads(token, { page, limit: leadsLimit, status: leadsStatus || undefined });
    setLeads(data.items || []);
    setLeadsTotal(Number(data.total || 0));
    setLeadsPage(Number(data.page || page));
  };

  const loadDesigners = async () => {
    const data = await adminFetchDesigners(token);
    setDesigners(data.designers || []);
    setDesignersLoaded(true);
  };

  useEffect(() => { refreshAll(); loadSiteSettings(); }, []);
  useEffect(() => { if (activeTab === 'orders') loadOrders(ordersPage); }, [activeTab, ordersPage, ordersStatus]);
  useEffect(() => { if (activeTab === 'leads') loadLeads(leadsPage); }, [activeTab, leadsPage, leadsStatus]);
  useEffect(() => { if (activeTab === 'designers' && !designersLoaded) loadDesigners(); }, [activeTab, designersLoaded]);
  useEffect(() => { setInvPage(1); }, [searchTerm]);

  useEffect(() => {
    setCategoryDrafts((prev) => {
      const next = { ...prev };
      adminCategories.forEach((cat: any) => {
        const id = String(cat.id || '');
        if (!id || next[id]) return;
        next[id] = {
          title: String(cat.title || id),
          styleVariant: Number(cat.styleVariant) === 2 ? 2 : 1,
          videoUrl: String(cat.videoUrl || ''),
          image: String(cat.image || ''),
          seoTitle: String(cat.seoTitle || ''),
          seoDescription: String(cat.seoDescription || ''),
          seoKeywords: String(cat.seoKeywords || ''),
        };
      });
      return next;
    });
  }, [adminCategories]);

  useEffect(() => {
    setDesignerDrafts((prev) => {
      const next = { ...prev };
      designers.forEach((d: any) => {
        const id = String(d.id || '');
        if (!id || next[id]) return;
        next[id] = {
          name: String(d.name || ''),
          position: String(d.position || ''),
          photo: String(d.photo || ''),
          bio: String(d.bio || ''),
          experienceYears: d.experienceYears !== undefined && d.experienceYears !== null ? String(d.experienceYears) : '',
          phone: String(d.phone || ''),
          email: String(d.email || ''),
          instagramUrl: String(d.instagramUrl || ''),
          whatsappUrl: String(d.whatsappUrl || ''),
          portfolio: Array.isArray(d.portfolio) ? d.portfolio : [],
          active: d.active !== false,
        };
      });
      return next;
    });
  }, [designers]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const filledImages = (images: string[]) => Array.from(new Set(images.map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 3);

  // ---------------- Products ----------------
  const openAddModal = () => {
    setAddForm({ ...emptyProductForm });
    setAddUseNewCategory(adminCategories.length === 0);
    setIsAddOpen(true);
  };

  const openEditModal = (prod: any, categoryId: string, categoryTitle: string) => {
    setEditId(String(prod.id));
    setEditForm({
      category_id: categoryId,
      category_title: categoryTitle,
      name: String(prod.name || ''),
      brand: String(prod.brand || ''),
      collection: String(prod.collection || ''),
      subcategory: String(prod.subcategory || ''),
      unit: String(prod.unit || 'шт'),
      sku: String(prod.sku || ''),
      images: [prod.images?.[0] || prod.image || '', prod.images?.[1] || '', prod.images?.[2] || ''],
      description: String(prod.description || ''),
      stockQty: prod.stockQty !== undefined ? String(prod.stockQty) : '',
      retail: prod?.prices?.retail !== undefined ? String(prod.prices.retail) : '',
      oldPrice: prod?.prices?.oldPrice !== undefined ? String(prod.prices.oldPrice) : '',
      wholesale: prod?.prices?.wholesale !== undefined ? String(prod.prices.wholesale) : '',
      note: String(prod?.prices?.note || ''),
      attrsText: attrsToEditorText(prod?.attrs || {}),
      inStock: !!prod.inStock,
    });
    setIsEditOpen(true);
  };

  const uploadImageForSlot = async (which: 'add' | 'edit', slotIndex: number, file?: File | null) => {
    if (!file) return;
    const setUploading = which === 'add' ? setAddImageUploading : setEditImageUploading;
    const setForm = which === 'add' ? setAddForm : setEditForm;
    setUploading(true);
    try {
      const res = await adminUploadProductImage(token, file);
      setForm((prev) => {
        const images = [...prev.images];
        images[slotIndex] = String(res.imageUrl || '');
        return { ...prev, images };
      });
    } catch (e: any) {
      alert(e?.message || 'Ошибка загрузки изображения');
    } finally {
      setUploading(false);
    }
  };

  const submitAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addForm.name.trim();
    const category_title = (addUseNewCategory ? addForm.category_title : (adminCategories.find((c) => c.id === addForm.category_id)?.title || addForm.category_title)).trim();
    const category_id = addUseNewCategory ? (addForm.category_id.trim() || undefined) : addForm.category_id.trim();
    if (!name || !category_title || (!addUseNewCategory && !category_id)) {
      alert('Заполните название товара и категорию');
      return;
    }

    const images = filledImages(addForm.images);
    const prices: any = {};
    const retail = parseNum(addForm.retail);
    const oldPrice = parseNum(addForm.oldPrice);
    const wholesale = parseNum(addForm.wholesale);
    if (retail !== undefined) prices.retail = retail;
    if (oldPrice !== undefined) prices.oldPrice = oldPrice;
    if (wholesale !== undefined) prices.wholesale = wholesale;
    if (addForm.note.trim()) prices.note = addForm.note.trim();

    try {
      await adminCreateProduct(token, {
        category_id,
        category_title,
        name,
        brand: addForm.brand.trim(),
        collection: addForm.collection.trim(),
        subcategory: addForm.subcategory.trim(),
        unit: addForm.unit.trim() || 'шт',
        sku: addForm.sku.trim(),
        image: images[0] || '',
        images,
        description: addForm.description.trim(),
        stockQty: parseNum(addForm.stockQty),
        inStock: !!addForm.inStock,
        prices,
        attrs: editorTextToAttrs(addForm.attrsText),
      });
      setIsAddOpen(false);
      await refreshAll();
    } catch (err: any) {
      alert(err?.message || 'Ошибка создания товара');
    }
  };

  const submitEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    const images = filledImages(editForm.images);
    const prices: any = {};
    const retail = parseNum(editForm.retail);
    const oldPrice = parseNum(editForm.oldPrice);
    const wholesale = parseNum(editForm.wholesale);
    if (retail !== undefined) prices.retail = retail;
    if (oldPrice !== undefined) prices.oldPrice = oldPrice;
    if (wholesale !== undefined) prices.wholesale = wholesale;
    if (editForm.note.trim()) prices.note = editForm.note.trim();

    try {
      await adminPatchProduct(token, editId, {
        name: editForm.name,
        brand: editForm.brand,
        collection: editForm.collection,
        subcategory: editForm.subcategory,
        unit: editForm.unit,
        sku: editForm.sku,
        image: images[0] || '',
        images,
        description: editForm.description,
        stockQty: parseNum(editForm.stockQty),
        inStock: editForm.inStock,
        prices,
        attrs: editorTextToAttrs(editForm.attrsText),
      });
      setIsEditOpen(false);
      await refreshAll();
    } catch (err: any) {
      alert(err?.message || 'Ошибка сохранения товара');
    }
  };

  const deleteProduct = async (prodId: string) => {
    if (!confirm('Удалить товар навсегда?')) return;
    try {
      await adminDeleteProduct(token, prodId);
      await refreshAll();
    } catch (e: any) {
      alert(e?.message || 'Ошибка');
    }
  };

  const toggleProductStock = async (prodId: string, current: boolean) => {
    try {
      await adminPatchProduct(token, prodId, { inStock: !current });
      await refreshAll();
    } catch (e: any) {
      alert(e?.message || 'Ошибка');
    }
  };

  // ---------------- Import ----------------
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const downloadImportTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      const blob = await adminDownloadImportTemplate(token);
      downloadBlob(blob, 'import-template.xlsx');
    } catch (e: any) {
      alert(e?.message || 'Ошибка скачивания шаблона');
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!importCategory && !importNewCategoryTitle.trim()) {
      alert('Выберите категорию или введите название новой категории.');
      e.target.value = '';
      return;
    }
    setIsImporting(true);
    try {
      const categoryId = importCategory || importNewCategoryTitle.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-');
      const brand = importNewBrandTitle.trim() || importBrand;
      const result = await adminImportExcel(token, file, categoryId, importNewCategoryTitle.trim() || (adminCategories.find((c) => c.id === importCategory)?.title || ''), brand);
      await refreshAll();
      const durationSec = Number(result?.durationMs || 0) > 0 ? ` · ${Math.round(Number(result.durationMs) / 1000)} сек` : '';
      setImportResult({
        type: 'success',
        title: `Импорт в категорию "${result?.category?.title || ''}" завершён`,
        details: `Распознано: ${result.totalParsed} · Добавлено: ${result.inserted} · Обновлено: ${result.updated} · Пропущено: ${result.skipped}${durationSec}`,
      });
      setActiveTab('inventory');
    } catch (error: any) {
      setImportResult({ type: 'error', title: 'Ошибка при импорте', details: error?.message || 'Не удалось обработать файл Excel' });
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  // ---------------- Categories ----------------
  const submitCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newCategoryForm.title.trim();
    if (!title) { alert('Введите название категории'); return; }
    setCreatingCategory(true);
    try {
      await adminCreateCategory(token, { title, styleVariant: newCategoryForm.styleVariant });
      setNewCategoryForm({ title: '', styleVariant: 1 });
      await refreshAll();
    } catch (e: any) {
      alert(e?.message || 'Ошибка создания категории');
    } finally {
      setCreatingCategory(false);
    }
  };

  const saveCategoryMeta = async (catId: string) => {
    const draft = categoryDrafts[catId];
    if (!draft) return;
    setCategorySaving((p) => ({ ...p, [catId]: true }));
    try {
      await adminPatchCategory(token, catId, draft);
      await refreshAll();
    } catch (e: any) {
      alert(e?.message || 'Ошибка сохранения категории');
    } finally {
      setCategorySaving((p) => ({ ...p, [catId]: false }));
    }
  };

  const uploadCategoryVideo = async (catId: string, file?: File | null) => {
    if (!file) return;
    setCategoryVideoUploading((p) => ({ ...p, [catId]: true }));
    try {
      const res = await adminUploadCategoryVideo(token, file);
      setCategoryDrafts((prev) => ({ ...prev, [catId]: { ...prev[catId], videoUrl: res.videoUrl } }));
    } catch (e: any) {
      alert(e?.message || 'Ошибка загрузки видео');
    } finally {
      setCategoryVideoUploading((p) => ({ ...p, [catId]: false }));
    }
  };

  const uploadCategoryImage = async (catId: string, file?: File | null) => {
    if (!file) return;
    setCategoryImageUploading((p) => ({ ...p, [catId]: true }));
    try {
      const url = await adminUploadImage(token, file);
      setCategoryDrafts((prev) => ({ ...prev, [catId]: { ...prev[catId], image: url } }));
    } catch (e: any) {
      alert(e?.message || 'Ошибка загрузки изображения');
    } finally {
      setCategoryImageUploading((p) => ({ ...p, [catId]: false }));
    }
  };

  const deleteCategoryById = async (catId: string) => {
    if (!window.confirm(`Удалить категорию ${catId}?`)) return;
    const removeProducts = window.confirm('Удалить также все товары этой категории? OK — удалить товары, Отмена — оставить товары.');
    setCategoryDeleting((p) => ({ ...p, [catId]: true }));
    try {
      await adminDeleteCategory(token, catId, removeProducts);
      await refreshAll();
    } catch (e: any) {
      alert(e?.message || 'Ошибка удаления категории');
    } finally {
      setCategoryDeleting((p) => ({ ...p, [catId]: false }));
    }
  };

  // ---------------- Designers ----------------
  const submitCreateDesigner = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newDesignerName.trim();
    if (!name) { alert('Введите имя дизайнера'); return; }
    setCreatingDesigner(true);
    try {
      await adminCreateDesigner(token, { name });
      setNewDesignerName('');
      await loadDesigners();
    } catch (e: any) {
      alert(e?.message || 'Ошибка создания дизайнера');
    } finally {
      setCreatingDesigner(false);
    }
  };

  const saveDesignerMeta = async (id: string) => {
    const draft = designerDrafts[id];
    if (!draft) return;
    if (!draft.name.trim()) { alert('Введите имя дизайнера'); return; }
    setDesignerSaving((p) => ({ ...p, [id]: true }));
    try {
      await adminPatchDesigner(token, id, {
        name: draft.name.trim(),
        position: draft.position.trim(),
        photo: draft.photo,
        bio: draft.bio.trim(),
        experienceYears: draft.experienceYears.trim() ? Number(draft.experienceYears) : '',
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        instagramUrl: draft.instagramUrl.trim(),
        whatsappUrl: draft.whatsappUrl.trim(),
        portfolio: draft.portfolio,
        active: draft.active,
      });
      await loadDesigners();
    } catch (e: any) {
      alert(e?.message || 'Ошибка сохранения дизайнера');
    } finally {
      setDesignerSaving((p) => ({ ...p, [id]: false }));
    }
  };

  const deleteDesignerById = async (id: string) => {
    if (!window.confirm('Удалить дизайнера?')) return;
    setDesignerDeleting((p) => ({ ...p, [id]: true }));
    try {
      await adminDeleteDesigner(token, id);
      await loadDesigners();
    } catch (e: any) {
      alert(e?.message || 'Ошибка удаления дизайнера');
    } finally {
      setDesignerDeleting((p) => ({ ...p, [id]: false }));
    }
  };

  const uploadDesignerPhoto = async (id: string, file?: File | null) => {
    if (!file) return;
    setDesignerPhotoUploading((p) => ({ ...p, [id]: true }));
    try {
      const url = await adminUploadImage(token, file);
      setDesignerDrafts((prev) => ({ ...prev, [id]: { ...prev[id], photo: url } }));
    } catch (e: any) {
      alert(e?.message || 'Ошибка загрузки фото');
    } finally {
      setDesignerPhotoUploading((p) => ({ ...p, [id]: false }));
    }
  };

  const uploadDesignerPortfolioImage = async (id: string, file?: File | null) => {
    if (!file) return;
    setDesignerPortfolioUploading((p) => ({ ...p, [id]: true }));
    try {
      const url = await adminUploadImage(token, file);
      setDesignerDrafts((prev) => ({ ...prev, [id]: { ...prev[id], portfolio: [...(prev[id]?.portfolio || []), url] } }));
    } catch (e: any) {
      alert(e?.message || 'Ошибка загрузки изображения');
    } finally {
      setDesignerPortfolioUploading((p) => ({ ...p, [id]: false }));
    }
  };

  const removeDesignerPortfolioImage = (id: string, idx: number) => {
    setDesignerDrafts((prev) => ({ ...prev, [id]: { ...prev[id], portfolio: (prev[id]?.portfolio || []).filter((_, i) => i !== idx) } }));
  };

  // ---------------- Site settings ----------------
  const updateHomepageImages = (patch: Partial<HomepageImages>) => {
    setSiteForm((prev) => ({ ...prev, homepageImages: { ...prev.homepageImages, ...patch } }));
  };

  const saveSiteSettings = async () => {
    setSettingsSaving(true);
    try {
      await adminSaveSiteSettings(token, siteForm);
      alert('Настройки сохранены');
    } catch (e: any) {
      alert(e?.message || 'Ошибка сохранения настроек');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handlePurgeAllData = async () => {
    if (!window.confirm('Это действие удалит ВСЕ товары, категории, заказы и заявки из базы. Продолжить?')) return;
    const textConfirm = window.prompt('Для подтверждения введите: DELETE_ALL');
    if (textConfirm !== 'DELETE_ALL') { alert('Удаление отменено: неверная фраза подтверждения.'); return; }
    const purgePassword = window.prompt('Введите специальный пароль для полного удаления:');
    if (!purgePassword) { alert('Удаление отменено: пароль не введён.'); return; }
    setIsPurgingAll(true);
    try {
      const result = await adminPurgeAll(token, purgePassword);
      await refreshAll();
      const d = result?.deleted || { products: 0, categories: 0, orders: 0, leads: 0 };
      alert(`База очищена: товары ${d.products}, категории ${d.categories}, заказы ${d.orders}, заявки ${d.leads}`);
    } catch (e: any) {
      alert(e?.message || 'Ошибка полного удаления базы');
    } finally {
      setIsPurgingAll(false);
    }
  };

  const handleDeleteProductsWithoutPhoto = async () => {
    setIsDeletingNoPhoto(true);
    try {
      const report = await adminCountProductsWithoutPhoto(token);
      if (report.count === 0) {
        alert('Товаров без фотографий не найдено — удалять нечего.');
        return;
      }

      // Показываем разбивку по категориям и несколько названий: без этого
      // пользователь подтверждает удаление вслепую, по одному числу.
      const byCat = report.byCategory
        .map((c) => `  • ${c.category_title || '(без категории)'} — ${c.count}`)
        .join('\n');
      const names = report.samples.slice(0, 10).map((p) => `  – ${p.name}`).join('\n');
      const more = report.count > 10 ? `\n  …и ещё ${report.count - 10}` : '';

      const ok = window.confirm(
        `Найдено товаров без фотографий: ${report.count}\n\nПо категориям:\n${byCat}\n\nНапример:\n${names}${more}\n\nУдалить их безвозвратно?`
      );
      if (!ok) return;

      const result = await adminDeleteProductsWithoutPhoto(token, report.count);
      await refreshAll();
      alert(`Удалено товаров без фотографий: ${result.deleted}`);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('count changed')) {
        alert('Количество товаров без фото изменилось, пока вы подтверждали (возможно, идёт импорт). Ничего не удалено — нажмите кнопку ещё раз.');
      } else {
        alert(msg || 'Ошибка удаления товаров без фотографий');
      }
    } finally {
      setIsDeletingNoPhoto(false);
    }
  };

  const invAll: any[] = adminCategories.flatMap((cat: any) => (cat.items || []).map((p: any) => ({ ...p, __catId: cat.id, __catTitle: cat.title })));
  const adminBrands = useMemo(
    () => Array.from(new Set(invAll.map((p: any) => String(p?.brand || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [invAll]
  );
  const invFiltered = invAll.filter((p: any) => String(p?.name || '').toLowerCase().includes(searchTerm.toLowerCase()));
  const invTotalPages = Math.max(1, Math.ceil(invFiltered.length / INV_PAGE_SIZE));
  const invPageSafe = Math.min(invPage, invTotalPages);
  const invItems = invFiltered.slice((invPageSafe - 1) * INV_PAGE_SIZE, invPageSafe * INV_PAGE_SIZE);

  const tabBtn = (tab: Tab, icon: string, label: string) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-6 py-3 rounded-2xl font-bold transition-all uppercase text-xs tracking-widest ${activeTab === tab ? 'bg-[#1D2B49] text-white' : 'bg-white text-gray-400 hover:bg-gray-100'}`}
    >
      <i className={`fas ${icon} mr-2`}></i>{label}
    </button>
  );

  return (
    <div className="container mx-auto px-6 py-12 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-[#1D2B49] uppercase tracking-tighter">Панель управления</h1>
          <p className="text-gray-500 font-medium">Bathroom Design — управление каталогом</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePurgeAllData}
            disabled={isPurgingAll}
            className={`px-5 py-3 font-bold rounded-xl text-sm uppercase tracking-widest ${isPurgingAll ? 'bg-red-100 text-red-300' : 'bg-red-600 text-white hover:bg-red-700'}`}
          >
            {isPurgingAll ? 'Очистка...' : 'Удалить всё из БД'}
          </button>
          <button onClick={onLogout} className="px-5 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition-all text-sm uppercase tracking-widest">
            Выйти
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-8">
        {tabBtn('inventory', 'fa-boxes', 'Товары')}
        {tabBtn('import', 'fa-file-import', 'Импорт Excel')}
        {tabBtn('orders', 'fa-clipboard-list', 'Заказы')}
        {tabBtn('leads', 'fa-inbox', 'Заявки')}
        {tabBtn('categories', 'fa-images', 'Категории')}
        {tabBtn('designers', 'fa-user-tie', 'Дизайнеры')}
        {tabBtn('settings', 'fa-gear', 'Настройки сайта')}
      </div>

      <div className="bg-white rounded-[32px] shadow-xl border border-gray-100 overflow-hidden">
        {activeTab === 'inventory' && (
          <div className="p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="relative w-full sm:w-96">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-11 pr-4 py-3 text-sm"
                  placeholder="Поиск товара..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDeleteProductsWithoutPhoto}
                  disabled={isDeletingNoPhoto}
                  title="Найти и удалить товары, у которых не заполнено ни одной фотографии"
                  className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest border ${isDeletingNoPhoto ? 'bg-amber-50 text-amber-300 border-amber-100' : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'}`}
                >
                  <i className="fas fa-trash mr-2"></i>
                  {isDeletingNoPhoto ? 'Проверка...' : 'Удалить без фото'}
                </button>
                <button onClick={openAddModal} className="px-6 py-3 rounded-2xl bg-[#1D2B49] text-white font-black uppercase text-xs tracking-widest hover:bg-[#152036]">
                  <i className="fas fa-plus mr-2"></i>Добавить товар
                </button>
              </div>
            </div>

            {invItems.length === 0 ? (
              <div className="p-16 text-center bg-gray-50 rounded-3xl border border-gray-100 text-gray-400">Товаров пока нет</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-widest text-gray-500">
                      <th className="py-3 px-2">Товар</th>
                      <th className="py-3 px-2">Категория</th>
                      <th className="py-3 px-2">Бренд</th>
                      <th className="py-3 px-2">Цена</th>
                      <th className="py-3 px-2">В наличии</th>
                      <th className="py-3 px-2 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invItems.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100">
                        <td className="py-3 px-2 font-bold text-[#1D2B49]">{p.name}<div className="text-xs text-gray-400 font-normal">{p.sku}</div></td>
                        <td className="py-3 px-2 text-sm text-gray-600">{p.__catTitle}</td>
                        <td className="py-3 px-2 text-sm text-gray-600">{p.brand}</td>
                        <td className="py-3 px-2 text-sm font-bold text-gray-800">{p.prices?.retail ? `${Number(p.prices.retail).toLocaleString('ru-RU')} ₸` : '-'}</td>
                        <td className="py-3 px-2">
                          <button
                            onClick={() => toggleProductStock(p.id, p.inStock)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold ${p.inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}
                          >
                            {p.inStock ? 'В наличии' : 'Нет в наличии'}
                          </button>
                        </td>
                        <td className="py-3 px-2 text-right whitespace-nowrap">
                          <button onClick={() => openEditModal(p, p.__catId, p.__catTitle)} className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold text-xs mr-2">Изменить</button>
                          <button onClick={() => deleteProduct(p.id)} className="px-3 py-2 rounded-xl bg-red-50 text-red-600 font-bold text-xs">Удалить</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-center gap-3 py-4">
                  <button onClick={() => setInvPage((p) => Math.max(1, p - 1))} disabled={invPageSafe <= 1} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold disabled:opacity-40">← Назад</button>
                  <div className="text-sm font-bold text-gray-600">Стр. {invPageSafe} / {invTotalPages}</div>
                  <button onClick={() => setInvPage((p) => Math.min(invTotalPages, p + 1))} disabled={invPageSafe >= invTotalPages} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold disabled:opacity-40">Вперёд →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'import' && (
          <div className="p-10 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-[#1D2B49] text-3xl">
              <i className="fas fa-file-excel"></i>
            </div>
            <h3 className="text-2xl font-black text-[#1D2B49] mb-3 uppercase tracking-tighter">Импорт из Excel</h3>
            <p className="text-gray-400 max-w-xl mx-auto mb-4 text-sm">
              Сначала выберите категорию (существующую или новую), затем загрузите Excel файл с товарами.
            </p>

            <button
              type="button"
              onClick={downloadImportTemplate}
              disabled={isDownloadingTemplate}
              className="inline-flex items-center gap-2 mb-8 text-xs font-bold text-[#CEA549] transition-colors hover:text-[#1D2B49] disabled:opacity-50"
            >
              <i className={`fas ${isDownloadingTemplate ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
              Скачать шаблон Excel (с колонкой «Подкатегория»)
            </button>

            <div className="max-w-md mx-auto space-y-3 text-left mb-8">
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Существующая категория</div>
                <select
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm"
                  value={importCategory}
                  onChange={(e) => { setImportCategory(e.target.value); if (e.target.value) setImportNewCategoryTitle(''); }}
                >
                  <option value="">— не выбрано —</option>
                  {adminCategories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div className="text-center text-xs text-gray-400">или</div>
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Новая категория (название)</div>
                <input
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm"
                  value={importNewCategoryTitle}
                  onChange={(e) => { setImportNewCategoryTitle(e.target.value); if (e.target.value) setImportCategory(''); }}
                  placeholder="Например: Смесители"
                />
              </div>

              <div className="pt-3 border-t border-gray-100">
                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Бренд (необязательно)</div>
                <select
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm"
                  value={importBrand}
                  onChange={(e) => { setImportBrand(e.target.value); if (e.target.value) setImportNewBrandTitle(''); }}
                >
                  <option value="">— не выбрано —</option>
                  {adminBrands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="text-center text-xs text-gray-400">или</div>
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Новый бренд (название)</div>
                <input
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm"
                  value={importNewBrandTitle}
                  onChange={(e) => { setImportNewBrandTitle(e.target.value); if (e.target.value) setImportBrand(''); }}
                  placeholder="Например: Allen Brau"
                />
              </div>
              <p className="text-xs text-gray-400">
                Если выбрать или ввести бренд здесь — он проставится у всех товаров файла, даже если в самом Excel колонки "Бренд" нет.
              </p>
            </div>

            <label className={`inline-flex items-center gap-3 px-10 py-5 rounded-3xl font-black uppercase tracking-widest text-sm cursor-pointer transition-all ${isImporting ? 'bg-gray-100 text-gray-400' : 'bg-[#1D2B49] hover:bg-[#152036] text-white'}`}>
              {isImporting ? <><i className="fas fa-spinner fa-spin"></i> Обработка...</> : <><i className="fas fa-cloud-upload-alt"></i> Выбрать файл Excel</>}
              <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleExcelImport} disabled={isImporting} />
            </label>

            {importResult ? (
              <div className={`max-w-xl mx-auto mt-8 p-5 rounded-2xl text-left text-sm ${importResult.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                <div className="font-black mb-1">{importResult.title}</div>
                <div>{importResult.details}</div>
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-xl font-black text-[#1D2B49] uppercase tracking-tighter">Заказы</h3>
              <select value={ordersStatus} onChange={(e) => { setOrdersPage(1); setOrdersStatus(e.target.value); }} className="px-4 py-2.5 rounded-2xl border border-gray-200 bg-white text-sm font-semibold">
                <option value="">Все статусы</option>
                <option value="new">Новые</option>
                <option value="processing">В обработке</option>
                <option value="completed">Выполнены</option>
                <option value="cancelled">Отменены</option>
              </select>
            </div>

            {orders.length === 0 ? (
              <div className="p-16 text-center bg-gray-50 rounded-3xl text-gray-400">Пока нет заказов</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-widest text-gray-500">
                      <th className="py-3 px-2">Дата</th>
                      <th className="py-3 px-2">Клиент</th>
                      <th className="py-3 px-2">Телефон</th>
                      <th className="py-3 px-2">Сумма</th>
                      <th className="py-3 px-2">Статус</th>
                      <th className="py-3 px-2 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-t border-gray-100">
                        <td className="py-3 px-2 text-sm text-gray-600">{o.createdAt ? new Date(o.createdAt).toLocaleString('ru-RU') : '-'}</td>
                        <td className="py-3 px-2 font-bold text-[#1D2B49]">{o.customerName || '-'}</td>
                        <td className="py-3 px-2 text-sm text-gray-600">{o.customerPhone}</td>
                        <td className="py-3 px-2 font-bold">{Number(o.total || 0).toLocaleString('ru-RU')} ₸</td>
                        <td className="py-3 px-2">
                          <select
                            value={o.status}
                            onChange={async (e) => { await adminPatchOrder(token, o.id, e.target.value); setOrders((prev) => prev.map((x) => x.id === o.id ? { ...x, status: e.target.value } : x)); }}
                            className="px-3 py-2 rounded-xl border border-gray-200 bg-white font-bold text-xs"
                          >
                            <option value="new">Новый</option>
                            <option value="processing">В обработке</option>
                            <option value="completed">Выполнен</option>
                            <option value="cancelled">Отменён</option>
                          </select>
                        </td>
                        <td className="py-3 px-2 text-right whitespace-nowrap">
                          <button onClick={async () => { setIsOrderOpen(true); setOrderLoading(true); setActiveOrder(null); const data = await adminFetchOrder(token, o.id); setActiveOrder(data.order); setOrderLoading(false); }} className="px-3 py-2 rounded-xl bg-[#1D2B49] text-white text-xs font-bold mr-2">Открыть</button>
                          <button onClick={() => setDeleteOrderConfirmId(o.id)} className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-bold">Удалить</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm text-gray-500">Всего: <span className="font-bold text-gray-800">{ordersTotal}</span></div>
                  <div className="flex gap-2">
                    <button onClick={() => setOrdersPage((p) => Math.max(1, p - 1))} disabled={ordersPage <= 1} className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold disabled:opacity-40">Назад</button>
                    <button onClick={() => setOrdersPage((p) => p + 1)} disabled={ordersPage * ordersLimit >= ordersTotal} className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold disabled:opacity-40">Далее</button>
                  </div>
                </div>
              </div>
            )}

            {deleteOrderConfirmId ? (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90]">
                <div className="bg-white rounded-3xl p-8 w-[92%] max-w-md">
                  <h4 className="text-xl font-black text-[#1D2B49] mb-2">Подтвердите удаление</h4>
                  <p className="text-gray-600 text-sm mb-6">Удалить заказ навсегда?</p>
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setDeleteOrderConfirmId('')} className="px-5 py-2.5 rounded-2xl border border-gray-200 text-xs font-bold">Отмена</button>
                    <button onClick={async () => { const id = deleteOrderConfirmId; setDeleteOrderConfirmId(''); await adminDeleteOrder(token, id); await loadOrders(ordersPage); }} className="px-5 py-2.5 rounded-2xl bg-red-600 text-white text-xs font-bold">Удалить</button>
                  </div>
                </div>
              </div>
            ) : null}

            {isOrderOpen ? (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90] p-4">
                <div className="bg-white rounded-3xl p-8 w-full max-w-3xl shadow-2xl max-h-[85vh] overflow-y-auto">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <h4 className="text-2xl font-black text-[#1D2B49]">Заказ</h4>
                    <button onClick={() => { setIsOrderOpen(false); setActiveOrder(null); }} className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center"><i className="fas fa-times"></i></button>
                  </div>
                  {orderLoading ? <div className="p-10 text-center text-gray-500">Загрузка...</div> : !activeOrder ? <div className="p-10 text-center text-gray-500">Не найдено</div> : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-sm">
                        <div className="bg-gray-50 rounded-2xl p-4"><b>Клиент:</b> {activeOrder.customerName || '-'}<br /><b>Тел:</b> {activeOrder.customerPhone}<br /><b>Email:</b> {activeOrder.customerEmail}</div>
                        <div className="bg-gray-50 rounded-2xl p-4"><b>Доставка:</b> {activeOrder.deliveryMethod}<br /><b>Оплата:</b> {activeOrder.paymentMethod}<br /><b>Адрес:</b> {activeOrder.address || '-'}</div>
                      </div>
                      <table className="w-full text-left text-sm mb-4">
                        <thead><tr className="text-xs uppercase text-gray-500"><th className="py-2">Товар</th><th className="py-2 text-right">Кол-во</th><th className="py-2 text-right">Цена</th><th className="py-2 text-right">Сумма</th></tr></thead>
                        <tbody>
                          {(activeOrder.items || []).map((it: any, idx: number) => (
                            <tr key={idx} className="border-t border-gray-100">
                              <td className="py-2">{it.name}</td>
                              <td className="py-2 text-right">{it.quantity}</td>
                              <td className="py-2 text-right">{Number(it.price || 0).toLocaleString('ru-RU')} ₸</td>
                              <td className="py-2 text-right font-bold">{Number(it.lineTotal || 0).toLocaleString('ru-RU')} ₸</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex items-center justify-between">
                        <div className="text-xl font-black">{Number(activeOrder.total || 0).toLocaleString('ru-RU')} ₸</div>
                        <button onClick={async () => { const blob = await adminExportOrder(token, activeOrder.id); downloadBlob(blob, `order_${activeOrder.id}.xlsx`); }} className="px-5 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-bold uppercase">Экспорт в Excel</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'leads' && (
          <div className="p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-xl font-black text-[#1D2B49] uppercase tracking-tighter">Заявки</h3>
              <select value={leadsStatus} onChange={(e) => { setLeadsPage(1); setLeadsStatus(e.target.value); }} className="px-4 py-2.5 rounded-2xl border border-gray-200 bg-white text-sm font-semibold">
                <option value="">Все статусы</option>
                <option value="new">Новые</option>
                <option value="processing">В обработке</option>
                <option value="done">Выполнены</option>
              </select>
            </div>

            {leads.length === 0 ? (
              <div className="p-16 text-center bg-gray-50 rounded-3xl text-gray-400">Пока нет заявок</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-widest text-gray-500">
                      <th className="py-3 px-2">Дата</th>
                      <th className="py-3 px-2">Имя</th>
                      <th className="py-3 px-2">Телефон</th>
                      <th className="py-3 px-2">Статус</th>
                      <th className="py-3 px-2 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="py-3 px-2 text-sm text-gray-600">{l.createdAt ? new Date(l.createdAt).toLocaleString('ru-RU') : '-'}</td>
                        <td className="py-3 px-2 font-bold text-[#1D2B49]">{l.name || '-'}</td>
                        <td className="py-3 px-2 text-sm text-gray-600">{l.phone}</td>
                        <td className="py-3 px-2">
                          <select value={l.status} onChange={async (e) => { await adminPatchLead(token, l.id, e.target.value); setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, status: e.target.value } : x)); }} className="px-3 py-2 rounded-xl border border-gray-200 bg-white font-bold text-xs">
                            <option value="new">Новая</option>
                            <option value="processing">В обработке</option>
                            <option value="done">Выполнена</option>
                          </select>
                        </td>
                        <td className="py-3 px-2 text-right whitespace-nowrap">
                          <button onClick={async () => { setIsLeadOpen(true); setLeadLoading(true); setActiveLead(null); const data = await adminFetchLead(token, l.id); setActiveLead(data.lead); setLeadLoading(false); }} className="px-3 py-2 rounded-xl bg-[#1D2B49] text-white text-xs font-bold mr-2">Открыть</button>
                          <button onClick={() => setDeleteLeadConfirmId(l.id)} className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-bold">Удалить</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm text-gray-500">Всего: <span className="font-bold text-gray-800">{leadsTotal}</span></div>
                  <div className="flex gap-2">
                    <button onClick={() => setLeadsPage((p) => Math.max(1, p - 1))} disabled={leadsPage <= 1} className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold disabled:opacity-40">Назад</button>
                    <button onClick={() => setLeadsPage((p) => p + 1)} disabled={leadsPage * leadsLimit >= leadsTotal} className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold disabled:opacity-40">Далее</button>
                  </div>
                </div>
              </div>
            )}

            {deleteLeadConfirmId ? (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90]">
                <div className="bg-white rounded-3xl p-8 w-[92%] max-w-md">
                  <h4 className="text-xl font-black text-[#1D2B49] mb-2">Подтвердите удаление</h4>
                  <p className="text-gray-600 text-sm mb-6">Удалить заявку навсегда?</p>
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setDeleteLeadConfirmId('')} className="px-5 py-2.5 rounded-2xl border border-gray-200 text-xs font-bold">Отмена</button>
                    <button onClick={async () => { const id = deleteLeadConfirmId; setDeleteLeadConfirmId(''); await adminDeleteLead(token, id); await loadLeads(leadsPage); }} className="px-5 py-2.5 rounded-2xl bg-red-600 text-white text-xs font-bold">Удалить</button>
                  </div>
                </div>
              </div>
            ) : null}

            {isLeadOpen ? (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90] p-4">
                <div className="bg-white rounded-3xl p-8 w-full max-w-xl shadow-2xl max-h-[85vh] overflow-y-auto">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <h4 className="text-2xl font-black text-[#1D2B49]">Заявка</h4>
                    <button onClick={() => { setIsLeadOpen(false); setActiveLead(null); }} className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center"><i className="fas fa-times"></i></button>
                  </div>
                  {leadLoading ? <div className="p-10 text-center text-gray-500">Загрузка...</div> : !activeLead ? <div className="p-10 text-center text-gray-500">Не найдено</div> : (
                    <div className="space-y-3 text-sm">
                      <div><b>Имя:</b> {activeLead.name || '-'}</div>
                      <div><b>Телефон:</b> {activeLead.phone}</div>
                      <div><b>Email:</b> {activeLead.email}</div>
                      {activeLead.message ? <div className="bg-gray-50 rounded-2xl p-4 whitespace-pre-wrap">{activeLead.message}</div> : null}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="p-8">
            <h3 className="text-xl font-black text-[#1D2B49] uppercase tracking-tighter mb-6">Категории</h3>

            <form onSubmit={submitCreateCategory} className="mb-8 bg-gray-50 rounded-3xl border border-gray-100 p-6">
              <div className="text-sm font-black text-[#1D2B49] uppercase tracking-widest mb-4">Добавить категорию</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200" value={newCategoryForm.title} onChange={(e) => setNewCategoryForm((p) => ({ ...p, title: e.target.value }))} placeholder="Название (например, Смесители)" />
                <select className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200" value={newCategoryForm.styleVariant} onChange={(e) => setNewCategoryForm((p) => ({ ...p, styleVariant: Number(e.target.value) === 2 ? 2 : 1 }))}>
                  <option value={1}>Стиль 1</option>
                  <option value={2}>Стиль 2 (с видео)</option>
                </select>
              </div>
              <button type="submit" disabled={creatingCategory} className={`mt-4 px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest ${creatingCategory ? 'bg-gray-200 text-gray-400' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'}`}>
                {creatingCategory ? 'Создание...' : 'Добавить категорию'}
              </button>
            </form>

            {adminCategories.length === 0 ? (
              <div className="p-16 text-center bg-gray-50 rounded-3xl text-gray-400">Категорий пока нет</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {adminCategories.map((cat: any) => {
                  const catId = String(cat.id || '');
                  const draft = categoryDrafts[catId] || { title: cat.title, styleVariant: 1, videoUrl: '', image: '', seoTitle: '', seoDescription: '', seoKeywords: '' };
                  const isSaving = !!categorySaving[catId];
                  const isDeleting = !!categoryDeleting[catId];
                  const isVideoUploading = !!categoryVideoUploading[catId];
                  const isImageUploading = !!categoryImageUploading[catId];

                  return (
                    <div key={catId} className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-lg font-black text-[#1D2B49]">{draft.title || catId}</div>
                        <div className="text-xs text-gray-400">{catId} · {cat.productsCount ?? cat.items?.length ?? 0} товаров</div>
                      </div>

                      {draft.image ? (
                        <div className="h-32 rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 mb-3">
                          <img src={normalizeAssetUrl(draft.image)} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : null}

                      <div className="space-y-3">
                        <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.title} onChange={(e) => setCategoryDrafts((p) => ({ ...p, [catId]: { ...draft, title: e.target.value } }))} placeholder="Название" />

                        <div className="grid grid-cols-2 gap-3">
                          <select className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.styleVariant} onChange={(e) => setCategoryDrafts((p) => ({ ...p, [catId]: { ...draft, styleVariant: Number(e.target.value) === 2 ? 2 : 1 } }))}>
                            <option value={1}>Стиль 1</option>
                            <option value={2}>Стиль 2 (видео)</option>
                          </select>
                          <label className={`flex items-center justify-center gap-2 px-3 py-3 rounded-2xl border text-xs font-bold ${isImageUploading ? 'bg-gray-100 text-gray-400' : 'bg-white text-[#1D2B49] border-gray-200 cursor-pointer hover:bg-gray-50'}`}>
                            <i className={`fas ${isImageUploading ? 'fa-spinner fa-spin' : 'fa-image'}`}></i> Изображение
                            <input type="file" accept="image/*" className="hidden" disabled={isImageUploading} onChange={(e) => { uploadCategoryImage(catId, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                          </label>
                        </div>

                        <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.videoUrl} onChange={(e) => setCategoryDrafts((p) => ({ ...p, [catId]: { ...draft, videoUrl: e.target.value } }))} placeholder="Видео URL (YouTube или mp4)" />
                        <label className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-bold ${isVideoUploading ? 'bg-gray-100 text-gray-400' : 'bg-white text-[#1D2B49] border-gray-200 cursor-pointer hover:bg-gray-50'}`}>
                          <i className={`fas ${isVideoUploading ? 'fa-spinner fa-spin' : 'fa-video'}`}></i> Загрузить видео
                          <input type="file" accept="video/mp4,video/webm,video/ogg" className="hidden" disabled={isVideoUploading} onChange={(e) => { uploadCategoryVideo(catId, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                        </label>

                        <div className="border-t border-gray-100 pt-3 space-y-2">
                          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">SEO</div>
                          <input className="w-full px-4 py-2 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.seoTitle} onChange={(e) => setCategoryDrafts((p) => ({ ...p, [catId]: { ...draft, seoTitle: e.target.value } }))} placeholder="SEO Title" />
                          <textarea className="w-full px-4 py-2 rounded-2xl bg-white border border-gray-200 text-sm" rows={2} value={draft.seoDescription} onChange={(e) => setCategoryDrafts((p) => ({ ...p, [catId]: { ...draft, seoDescription: e.target.value } }))} placeholder="SEO Description" />
                          <input className="w-full px-4 py-2 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.seoKeywords} onChange={(e) => setCategoryDrafts((p) => ({ ...p, [catId]: { ...draft, seoKeywords: e.target.value } }))} placeholder="SEO Keywords" />
                        </div>

                        <div className="flex gap-3">
                          <button type="button" onClick={() => saveCategoryMeta(catId)} disabled={isSaving} className={`px-5 py-2.5 rounded-2xl font-black text-xs uppercase ${isSaving ? 'bg-gray-100 text-gray-400' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'}`}>
                            {isSaving ? 'Сохранение...' : 'Сохранить'}
                          </button>
                          <button type="button" onClick={() => deleteCategoryById(catId)} disabled={isDeleting} className={`px-5 py-2.5 rounded-2xl font-black text-xs uppercase ${isDeleting ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                            {isDeleting ? 'Удаление...' : 'Удалить'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'designers' && (
          <div className="p-8">
            <h3 className="text-xl font-black text-[#1D2B49] uppercase tracking-tighter mb-6">Дизайнеры</h3>

            <form onSubmit={submitCreateDesigner} className="mb-8 bg-gray-50 rounded-3xl border border-gray-100 p-6">
              <div className="text-sm font-black text-[#1D2B49] uppercase tracking-widest mb-4">Добавить дизайнера</div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  className="flex-1 px-4 py-3 rounded-2xl bg-white border border-gray-200"
                  value={newDesignerName}
                  onChange={(e) => setNewDesignerName(e.target.value)}
                  placeholder="Имя дизайнера"
                />
                <button
                  type="submit"
                  disabled={creatingDesigner}
                  className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest whitespace-nowrap ${creatingDesigner ? 'bg-gray-200 text-gray-400' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'}`}
                >
                  {creatingDesigner ? 'Создание...' : 'Добавить дизайнера'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3">Остальные данные (фото, описание, контакты, портфолио) заполните после создания карточки.</p>
            </form>

            {!designersLoaded ? (
              <div className="p-16 text-center text-gray-400">Загрузка...</div>
            ) : designers.length === 0 ? (
              <div className="p-16 text-center bg-gray-50 rounded-3xl text-gray-400">Дизайнеров пока нет</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {designers.map((d: any) => {
                  const id = String(d.id || '');
                  const draft = designerDrafts[id] || { ...emptyDesignerDraft, name: d.name };
                  const isSaving = !!designerSaving[id];
                  const isDeleting = !!designerDeleting[id];
                  const isPhotoUploading = !!designerPhotoUploading[id];
                  const isPortfolioUploading = !!designerPortfolioUploading[id];

                  return (
                    <div key={id} className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-lg font-black text-[#1D2B49]">{draft.name || 'Без имени'}</div>
                        <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
                          <input
                            type="checkbox"
                            checked={draft.active}
                            onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, active: e.target.checked } }))}
                          />
                          Показывать на сайте
                        </label>
                      </div>

                      <div className="flex gap-4 mb-4">
                        <div className="w-24 h-24 flex-shrink-0 rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center">
                          {draft.photo ? (
                            <img src={normalizeAssetUrl(draft.photo)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <i className="fas fa-user text-2xl text-gray-300"></i>
                          )}
                        </div>
                        <label className={`flex items-center justify-center gap-2 px-3 py-2 h-fit rounded-2xl border text-xs font-bold ${isPhotoUploading ? 'bg-gray-100 text-gray-400' : 'bg-white text-[#1D2B49] border-gray-200 cursor-pointer hover:bg-gray-50'}`}>
                          <i className={`fas ${isPhotoUploading ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i> Фото
                          <input type="file" accept="image/*" className="hidden" disabled={isPhotoUploading} onChange={(e) => { uploadDesignerPhoto(id, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                        </label>
                      </div>

                      <div className="space-y-3">
                        <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.name} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, name: e.target.value } }))} placeholder="Имя" />
                        <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.position} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, position: e.target.value } }))} placeholder="Должность (например, Ведущий дизайнер)" />
                        <textarea className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm min-h-[90px]" value={draft.bio} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, bio: e.target.value } }))} placeholder="Описание / о дизайнере" />
                        <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.experienceYears} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, experienceYears: e.target.value.replace(/[^\d]/g, '') } }))} placeholder="Опыт работы (лет)" />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.phone} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, phone: e.target.value } }))} placeholder="Телефон" />
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.email} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, email: e.target.value } }))} placeholder="Email" />
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.instagramUrl} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, instagramUrl: e.target.value } }))} placeholder="Ссылка Instagram" />
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.whatsappUrl} onChange={(e) => setDesignerDrafts((p) => ({ ...p, [id]: { ...draft, whatsappUrl: e.target.value } }))} placeholder="Ссылка WhatsApp (wa.me/...)" />
                        </div>

                        <div className="border-t border-gray-100 pt-3 space-y-2">
                          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Портфолио</div>
                          <div className="flex flex-wrap gap-2">
                            {draft.portfolio.map((src, idx) => (
                              <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-100 bg-gray-50 group">
                                <img src={normalizeAssetUrl(src)} alt="" className="w-full h-full object-cover" />
                                <button
                                  type="button"
                                  onClick={() => removeDesignerPortfolioImage(id, idx)}
                                  className="absolute inset-0 bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                >
                                  <i className="fas fa-trash"></i>
                                </button>
                              </div>
                            ))}
                            <label className={`w-16 h-16 flex items-center justify-center rounded-xl border-2 border-dashed text-xs ${isPortfolioUploading ? 'bg-gray-100 text-gray-400 border-gray-200' : 'border-gray-300 text-gray-400 cursor-pointer hover:bg-gray-50'}`}>
                              <i className={`fas ${isPortfolioUploading ? 'fa-spinner fa-spin' : 'fa-plus'}`}></i>
                              <input type="file" accept="image/*" className="hidden" disabled={isPortfolioUploading} onChange={(e) => { uploadDesignerPortfolioImage(id, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                            </label>
                          </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                          <button type="button" onClick={() => saveDesignerMeta(id)} disabled={isSaving} className={`px-5 py-2.5 rounded-2xl font-black text-xs uppercase ${isSaving ? 'bg-gray-100 text-gray-400' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'}`}>
                            {isSaving ? 'Сохранение...' : 'Сохранить'}
                          </button>
                          <button type="button" onClick={() => deleteDesignerById(id)} disabled={isDeleting} className={`px-5 py-2.5 rounded-2xl font-black text-xs uppercase ${isDeleting ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                            {isDeleting ? 'Удаление...' : 'Удалить'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-[#1D2B49] uppercase tracking-tighter">Настройки сайта</h3>
              <button onClick={saveSiteSettings} disabled={settingsSaving || settingsLoading} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest ${settingsSaving ? 'bg-gray-100 text-gray-400' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'}`}>
                {settingsSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>

            {settingsLoading ? <div className="p-16 text-center text-gray-500">Загрузка...</div> : (
              <>
                <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                  <h4 className="text-sm font-black text-[#1D2B49] uppercase tracking-wider mb-4">Контакты</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={siteForm.phone} onChange={(e) => setSiteForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Телефон" />
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={siteForm.email} onChange={(e) => setSiteForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" />
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={siteForm.address} onChange={(e) => setSiteForm((p) => ({ ...p, address: e.target.value }))} placeholder="Адрес" />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                  <h4 className="text-sm font-black text-[#1D2B49] uppercase tracking-wider mb-4">Соцсети</h4>
                  <p className="text-xs text-gray-400 mb-4">Иконка появится в футере только если ссылка заполнена.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={siteForm.instagramUrl || ''} onChange={(e) => setSiteForm((p) => ({ ...p, instagramUrl: e.target.value }))} placeholder="Ссылка на Instagram" />
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={siteForm.facebookUrl || ''} onChange={(e) => setSiteForm((p) => ({ ...p, facebookUrl: e.target.value }))} placeholder="Ссылка на Facebook" />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                  <h4 className="text-sm font-black text-[#1D2B49] uppercase tracking-wider mb-4">Оплата (Kaspi / Halyk)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={siteForm.kaspiEnabled} onChange={(e) => setSiteForm((p) => ({ ...p, kaspiEnabled: e.target.checked }))} />
                        Показать Kaspi
                      </label>
                      <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={siteForm.kaspiUrl} onChange={(e) => setSiteForm((p) => ({ ...p, kaspiUrl: e.target.value }))} placeholder="Ссылка Kaspi" />
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={siteForm.halykEnabled} onChange={(e) => setSiteForm((p) => ({ ...p, halykEnabled: e.target.checked }))} />
                        Показать Halyk
                      </label>
                      <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={siteForm.halykUrl} onChange={(e) => setSiteForm((p) => ({ ...p, halykUrl: e.target.value }))} placeholder="Ссылка Halyk" />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100 space-y-4">
                  <h4 className="text-sm font-black text-[#1D2B49] uppercase tracking-wider">Логотипы</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[{ key: 'headerLogo', label: 'Логотип в Header' }, { key: 'footerLogo', label: 'Логотип в Footer' }].map((item) => {
                      const value = (siteForm.homepageImages as any)[item.key] as string;
                      const preview = normalizeAssetUrl(value);
                      return (
                        <div key={item.key} className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                          <div className="text-sm font-black text-gray-700 uppercase">{item.label}</div>
                          <div className="h-24 rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
                            {preview ? <img src={preview} alt="" className="w-full h-full object-contain" /> : <i className="fas fa-image text-2xl text-gray-300"></i>}
                          </div>
                          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200">
                            <i className="fas fa-upload"></i> Загрузить
                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try { const url = await adminUploadImage(token, file); updateHomepageImages({ [item.key]: url } as any); }
                              catch { alert('Ошибка загрузки'); }
                              finally { e.target.value = ''; }
                            }} />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-black text-[#1D2B49] uppercase tracking-wider">Слайды Hero</h4>
                    <button type="button" onClick={() => setSiteForm((p) => ({ ...p, heroSlides: [...p.heroSlides, { title: '', subtitle: '', desc: '', img: '' }] }))} className="px-4 py-2 rounded-xl bg-[#1D2B49] text-white text-xs font-black uppercase">+ Добавить</button>
                  </div>
                  <div className="space-y-4">
                    {siteForm.heroSlides.map((slide, idx) => (
                      <div key={idx} className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-black text-gray-500 uppercase">Слайд #{idx + 1}</div>
                          <button type="button" onClick={() => setSiteForm((p) => ({ ...p, heroSlides: p.heroSlides.filter((_, i) => i !== idx) }))} className="text-xs font-bold text-red-500">Удалить</button>
                        </div>
                        <input className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm" value={slide.subtitle} onChange={(e) => setSiteForm((p) => ({ ...p, heroSlides: p.heroSlides.map((s, i) => i === idx ? { ...s, subtitle: e.target.value } : s) }))} placeholder="Подзаголовок" />
                        <input className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm" value={slide.title} onChange={(e) => setSiteForm((p) => ({ ...p, heroSlides: p.heroSlides.map((s, i) => i === idx ? { ...s, title: e.target.value } : s) }))} placeholder="Заголовок" />
                        <textarea className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm" value={slide.desc} onChange={(e) => setSiteForm((p) => ({ ...p, heroSlides: p.heroSlides.map((s, i) => i === idx ? { ...s, desc: e.target.value } : s) }))} placeholder="Описание" />
                        <div className="flex gap-3 items-center">
                          {slide.img ? <img src={normalizeAssetUrl(slide.img)} alt="" className="w-20 h-16 rounded-xl object-cover border border-gray-200" /> : null}
                          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200">
                            <i className="fas fa-upload"></i> Загрузить фото
                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try { const url = await adminUploadImage(token, file); setSiteForm((p) => ({ ...p, heroSlides: p.heroSlides.map((s, i) => i === idx ? { ...s, img: url } : s) })); }
                              catch { alert('Ошибка загрузки'); }
                              finally { e.target.value = ''; }
                            }} />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-black text-[#1D2B49] uppercase tracking-wider">Цвета и покрытия</h4>
                    <button
                      type="button"
                      onClick={() => setSiteForm((p) => ({ ...p, colorSwatches: [...(p.colorSwatches || []), { code: '', title: '', image: '' }] }))}
                      className="px-4 py-2 rounded-xl bg-[#1D2B49] text-white text-xs font-black uppercase"
                    >
                      + Добавить
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mb-4">Отображаются на главной странице сеткой (например, хром, матовый чёрный, золото).</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(siteForm.colorSwatches || []).map((swatch, idx) => {
                      const preview = normalizeAssetUrl(swatch.image);
                      return (
                        <div key={idx} className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-black text-gray-500 uppercase">Образец #{idx + 1}</div>
                            <button
                              type="button"
                              onClick={() => setSiteForm((p) => ({ ...p, colorSwatches: (p.colorSwatches || []).filter((_, i) => i !== idx) }))}
                              className="text-xs font-bold text-red-500"
                            >
                              Удалить
                            </button>
                          </div>
                          <div className="h-24 rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
                            {preview ? <img src={preview} alt="" className="w-full h-full object-cover" /> : <i className="fas fa-image text-2xl text-gray-300"></i>}
                          </div>
                          <input
                            className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm"
                            value={swatch.code}
                            onChange={(e) => setSiteForm((p) => ({ ...p, colorSwatches: (p.colorSwatches || []).map((s, i) => i === idx ? { ...s, code: e.target.value } : s) }))}
                            placeholder="Код (например, CR, MB, GD)"
                          />
                          <input
                            className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm"
                            value={swatch.title}
                            onChange={(e) => setSiteForm((p) => ({ ...p, colorSwatches: (p.colorSwatches || []).map((s, i) => i === idx ? { ...s, title: e.target.value } : s) }))}
                            placeholder="Название (например, Хром)"
                          />
                          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200">
                            <i className="fas fa-upload"></i> Загрузить фото
                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try { const url = await adminUploadImage(token, file); setSiteForm((p) => ({ ...p, colorSwatches: (p.colorSwatches || []).map((s, i) => i === idx ? { ...s, image: url } : s) })); }
                              catch { alert('Ошибка загрузки'); }
                              finally { e.target.value = ''; }
                            }} />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-black text-[#1D2B49] uppercase tracking-wider">Слайды "О компании"</h4>
                    <button type="button" onClick={() => setSiteForm((p) => ({ ...p, aboutSlides: [...p.aboutSlides, { title: '', text: '', imageUrl: '', bullets: [] }] }))} className="px-4 py-2 rounded-xl bg-[#1D2B49] text-white text-xs font-black uppercase">+ Добавить</button>
                  </div>
                  <div className="space-y-4">
                    {siteForm.aboutSlides.map((slide, idx) => (
                      <div key={idx} className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-black text-gray-500 uppercase">Слайд #{idx + 1}</div>
                          <button type="button" onClick={() => setSiteForm((p) => ({ ...p, aboutSlides: p.aboutSlides.filter((_, i) => i !== idx) }))} className="text-xs font-bold text-red-500">Удалить</button>
                        </div>
                        <input className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm" value={slide.title} onChange={(e) => setSiteForm((p) => ({ ...p, aboutSlides: p.aboutSlides.map((s, i) => i === idx ? { ...s, title: e.target.value } : s) }))} placeholder="Заголовок" />
                        <textarea className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm" value={slide.text} onChange={(e) => setSiteForm((p) => ({ ...p, aboutSlides: p.aboutSlides.map((s, i) => i === idx ? { ...s, text: e.target.value } : s) }))} placeholder="Текст" />
                        <textarea className="w-full px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-sm" value={(slide.bullets || []).join('\n')} onChange={(e) => setSiteForm((p) => ({ ...p, aboutSlides: p.aboutSlides.map((s, i) => i === idx ? { ...s, bullets: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) } : s) }))} placeholder="Пункты списка (по одному на строку)" />
                        <div className="flex gap-3 items-center">
                          {slide.imageUrl ? <img src={normalizeAssetUrl(slide.imageUrl)} alt="" className="w-20 h-16 rounded-xl object-cover border border-gray-200" /> : null}
                          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200">
                            <i className="fas fa-upload"></i> Загрузить фото
                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try { const url = await adminUploadImage(token, file); setSiteForm((p) => ({ ...p, aboutSlides: p.aboutSlides.map((s, i) => i === idx ? { ...s, imageUrl: url } : s) })); }
                              catch { alert('Ошибка загрузки'); }
                              finally { e.target.value = ''; }
                            }} />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Add product modal */}
      {isAddOpen ? (
        <ProductFormModal
          title="Добавить товар"
          form={addForm}
          setForm={setAddForm}
          onClose={() => setIsAddOpen(false)}
          onSubmit={submitAddProduct}
          categories={adminCategories}
          useNewCategory={addUseNewCategory}
          setUseNewCategory={setAddUseNewCategory}
          isImageUploading={addImageUploading}
          onUploadImage={(idx, file) => uploadImageForSlot('add', idx, file)}
        />
      ) : null}

      {/* Edit product modal */}
      {isEditOpen ? (
        <ProductFormModal
          title="Изменить товар"
          form={editForm}
          setForm={setEditForm}
          onClose={() => setIsEditOpen(false)}
          onSubmit={submitEditProduct}
          categories={adminCategories}
          useNewCategory={false}
          setUseNewCategory={() => {}}
          isImageUploading={editImageUploading}
          onUploadImage={(idx, file) => uploadImageForSlot('edit', idx, file)}
          lockCategory
        />
      ) : null}
    </div>
  );
};

interface ProductFormModalProps {
  title: string;
  form: typeof emptyProductForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyProductForm>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  categories: Category[];
  useNewCategory: boolean;
  setUseNewCategory: (v: boolean) => void;
  isImageUploading: boolean;
  onUploadImage: (idx: number, file?: File | null) => void;
  lockCategory?: boolean;
}

const ProductFormModal: React.FC<ProductFormModalProps> = ({ title, form, setForm, onClose, onSubmit, categories, useNewCategory, setUseNewCategory, isImageUploading, onUploadImage, lockCategory }) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[95] p-4">
      <div className="bg-white rounded-3xl p-8 w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <h4 className="text-2xl font-black text-[#1D2B49]">{title}</h4>
          <button onClick={onClose} className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center"><i className="fas fa-times"></i></button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {!lockCategory ? (
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase mb-2">Категория</div>
              {!useNewCategory ? (
                <div className="flex gap-3">
                  <select
                    className="flex-1 px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm"
                    value={form.category_id}
                    onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}
                  >
                    <option value="">— выберите категорию —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                  <button type="button" onClick={() => setUseNewCategory(true)} className="px-4 py-3 rounded-2xl border border-gray-200 text-sm font-bold text-[#1D2B49] hover:bg-gray-50">+ Новая</button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <input className="flex-1 px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.category_title} onChange={(e) => setForm((p) => ({ ...p, category_title: e.target.value }))} placeholder="Название новой категории" />
                  <button type="button" onClick={() => setUseNewCategory(false)} className="px-4 py-3 rounded-2xl border border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50">Отмена</button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500">Категория: <b className="text-[#1D2B49]">{form.category_title}</b></div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Название товара *" required />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.brand} onChange={(e) => setForm((p) => ({ ...p, brand: e.target.value }))} placeholder="Бренд (например, Grohe)" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.collection} onChange={(e) => setForm((p) => ({ ...p, collection: e.target.value }))} placeholder="Коллекция / серия" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.subcategory} onChange={(e) => setForm((p) => ({ ...p, subcategory: e.target.value }))} placeholder="Подкатегория (напр. Смесители для раковины)" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.sku} onChange={(e) => setForm((p) => ({ ...p, sku: e.target.value }))} placeholder="Артикул" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.unit} onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))} placeholder="Единица измерения (шт)" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.stockQty} onChange={(e) => setForm((p) => ({ ...p, stockQty: e.target.value }))} placeholder="Остаток на складе" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.retail} onChange={(e) => setForm((p) => ({ ...p, retail: e.target.value }))} placeholder="Цена розница" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.oldPrice} onChange={(e) => setForm((p) => ({ ...p, oldPrice: e.target.value }))} placeholder="Старая цена" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.wholesale} onChange={(e) => setForm((p) => ({ ...p, wholesale: e.target.value }))} placeholder="Опт. цена" />
            <input className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Примечание (напр. По запросу)" />
          </div>

          <textarea className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm min-h-[90px]" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Описание" />
          <textarea className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm min-h-[90px]" value={form.attrsText} onChange={(e) => setForm((p) => ({ ...p, attrsText: e.target.value }))} placeholder={'Характеристики (по одной на строку в формате "Ключ: значение")'} />

          <div>
            <div className="text-xs font-bold text-gray-500 uppercase mb-2">Изображения (до 3-х)</div>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="space-y-2">
                  <div className="h-24 rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
                    {form.images[idx] ? <img src={normalizeAssetUrl(form.images[idx])} alt="" className="w-full h-full object-cover" /> : <i className="fas fa-image text-2xl text-gray-300"></i>}
                  </div>
                  <label className={`w-full flex items-center justify-center gap-1 px-2 py-2 rounded-xl border text-[11px] font-bold ${isImageUploading ? 'bg-gray-100 text-gray-400' : 'bg-white text-[#1D2B49] border-gray-200 cursor-pointer hover:bg-gray-50'}`}>
                    <i className={`fas ${isImageUploading ? 'fa-spinner fa-spin' : 'fa-upload'}`}></i> Загрузить
                    <input type="file" accept="image/*" className="hidden" disabled={isImageUploading} onChange={(e) => { onUploadImage(idx, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={form.inStock} onChange={(e) => setForm((p) => ({ ...p, inStock: e.target.checked }))} />
            В наличии
          </label>

          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-2xl border border-gray-200 text-sm font-bold text-gray-500">Отмена</button>
            <button type="submit" className="px-6 py-3 rounded-2xl bg-[#1D2B49] text-white text-sm font-black uppercase tracking-widest hover:bg-[#152036]">Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminDashboard;
