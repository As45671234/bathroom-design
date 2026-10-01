import React, { useEffect, useState } from 'react';
import {
  adminFetchPartners, adminCreatePartner, adminPatchPartner, adminDeletePartner,
  adminUploadImage, PartnerKind,
} from '../../services/api';
import { normalizeAssetUrl } from '../../utils/assetUrl';

/**
 * CRUD for one kind of partner (designers or construction crews). Both have an
 * identical record shape, so the two admin tabs are this same component with
 * different wording — see PartnersDirectory.tsx for the public counterpart.
 */
export interface PartnersAdminLabels {
  heading: string;
  addSectionTitle: string;
  addButton: string;
  addButtonBusy: string;
  newNamePlaceholder: string;
  namePlaceholder: string;
  positionPlaceholder: string;
  bioPlaceholder: string;
  emptyText: string;
  nameRequired: string;
  deleteConfirm: string;
  /** Font Awesome class for the empty-photo placeholder. */
  photoPlaceholderIcon: string;
}

interface PartnerDraft {
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

const emptyDraft: PartnerDraft = {
  name: '', position: '', photo: '', bio: '', experienceYears: '',
  phone: '', email: '', instagramUrl: '', whatsappUrl: '', portfolio: [], active: true,
};

interface PartnersAdminTabProps {
  token: string;
  kind: PartnerKind;
  labels: PartnersAdminLabels;
}

const PartnersAdminTab: React.FC<PartnersAdminTabProps> = ({ token, kind, labels }) => {
  const [partners, setPartners] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PartnerDraft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [photoUploading, setPhotoUploading] = useState<Record<string, boolean>>({});
  const [portfolioUploading, setPortfolioUploading] = useState<Record<string, boolean>>({});

  const load = async () => {
    const data = await adminFetchPartners(token, kind);
    setPartners(data.partners || []);
    setLoaded(true);
  };

  // Mounted only while its tab is open, so this doubles as the lazy load.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Seed an editable draft for every record that doesn't have one yet. Existing
  // drafts are left alone so a reload can't discard half-typed edits.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      partners.forEach((d: any) => {
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
  }, [partners]);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) { alert(labels.nameRequired); return; }
    setCreating(true);
    try {
      await adminCreatePartner(token, kind, { name });
      setNewName('');
      await load();
    } catch (err: any) {
      alert(err?.message || 'Ошибка создания');
    } finally {
      setCreating(false);
    }
  };

  const saveMeta = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    if (!draft.name.trim()) { alert(labels.nameRequired); return; }
    setSaving((p) => ({ ...p, [id]: true }));
    try {
      await adminPatchPartner(token, kind, id, {
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
      await load();
    } catch (err: any) {
      alert(err?.message || 'Ошибка сохранения');
    } finally {
      setSaving((p) => ({ ...p, [id]: false }));
    }
  };

  const deleteById = async (id: string) => {
    if (!window.confirm(labels.deleteConfirm)) return;
    setDeleting((p) => ({ ...p, [id]: true }));
    try {
      await adminDeletePartner(token, kind, id);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Ошибка удаления');
    } finally {
      setDeleting((p) => ({ ...p, [id]: false }));
    }
  };

  const uploadPhoto = async (id: string, file?: File | null) => {
    if (!file) return;
    setPhotoUploading((p) => ({ ...p, [id]: true }));
    try {
      const url = await adminUploadImage(token, file);
      setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], photo: url } }));
    } catch (err: any) {
      alert(err?.message || 'Ошибка загрузки фото');
    } finally {
      setPhotoUploading((p) => ({ ...p, [id]: false }));
    }
  };

  const uploadPortfolioImage = async (id: string, file?: File | null) => {
    if (!file) return;
    setPortfolioUploading((p) => ({ ...p, [id]: true }));
    try {
      const url = await adminUploadImage(token, file);
      setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], portfolio: [...(prev[id]?.portfolio || []), url] } }));
    } catch (err: any) {
      alert(err?.message || 'Ошибка загрузки изображения');
    } finally {
      setPortfolioUploading((p) => ({ ...p, [id]: false }));
    }
  };

  const removePortfolioImage = (id: string, idx: number) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], portfolio: (prev[id]?.portfolio || []).filter((_, i) => i !== idx) } }));
  };

  return (
    <div className="p-8">
      <h3 className="text-xl font-black text-[#1D2B49] uppercase tracking-tighter mb-6">{labels.heading}</h3>

      <form onSubmit={submitCreate} className="mb-8 bg-gray-50 rounded-3xl border border-gray-100 p-6">
        <div className="text-sm font-black text-[#1D2B49] uppercase tracking-widest mb-4">{labels.addSectionTitle}</div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="flex-1 px-4 py-3 rounded-2xl bg-white border border-gray-200"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={labels.newNamePlaceholder}
          />
          <button
            type="submit"
            disabled={creating}
            className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest whitespace-nowrap ${creating ? 'bg-gray-200 text-gray-400' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'}`}
          >
            {creating ? labels.addButtonBusy : labels.addButton}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">Остальные данные (фото, описание, контакты, портфолио) заполните после создания карточки.</p>
      </form>

      {!loaded ? (
        <div className="p-16 text-center text-gray-400">Загрузка...</div>
      ) : partners.length === 0 ? (
        <div className="p-16 text-center bg-gray-50 rounded-3xl text-gray-400">{labels.emptyText}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {partners.map((d: any) => {
            const id = String(d.id || '');
            const draft = drafts[id] || { ...emptyDraft, name: d.name };
            const isSaving = !!saving[id];
            const isDeleting = !!deleting[id];
            const isPhotoUploading = !!photoUploading[id];
            const isPortfolioUploading = !!portfolioUploading[id];

            return (
              <div key={id} className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-lg font-black text-[#1D2B49]">{draft.name || 'Без имени'}</div>
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, active: e.target.checked } }))}
                    />
                    Показывать на сайте
                  </label>
                </div>

                <div className="flex gap-4 mb-4">
                  <div className="w-24 h-24 flex-shrink-0 rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center">
                    {draft.photo ? (
                      <img src={normalizeAssetUrl(draft.photo)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <i className={`fas ${labels.photoPlaceholderIcon} text-2xl text-gray-300`}></i>
                    )}
                  </div>
                  <label className={`flex items-center justify-center gap-2 px-3 py-2 h-fit rounded-2xl border text-xs font-bold ${isPhotoUploading ? 'bg-gray-100 text-gray-400' : 'bg-white text-[#1D2B49] border-gray-200 cursor-pointer hover:bg-gray-50'}`}>
                    <i className={`fas ${isPhotoUploading ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i> Фото
                    <input type="file" accept="image/*" className="hidden" disabled={isPhotoUploading} onChange={(e) => { uploadPhoto(id, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </div>

                <div className="space-y-3">
                  <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.name} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, name: e.target.value } }))} placeholder={labels.namePlaceholder} />
                  <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.position} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, position: e.target.value } }))} placeholder={labels.positionPlaceholder} />
                  <textarea className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm min-h-[90px]" value={draft.bio} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, bio: e.target.value } }))} placeholder={labels.bioPlaceholder} />
                  <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.experienceYears} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, experienceYears: e.target.value.replace(/[^\d]/g, '') } }))} placeholder="Опыт работы (лет)" />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.phone} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, phone: e.target.value } }))} placeholder="Телефон" />
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.email} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, email: e.target.value } }))} placeholder="Email" />
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.instagramUrl} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, instagramUrl: e.target.value } }))} placeholder="Ссылка Instagram" />
                    <input className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm" value={draft.whatsappUrl} onChange={(e) => setDrafts((p) => ({ ...p, [id]: { ...draft, whatsappUrl: e.target.value } }))} placeholder="Ссылка WhatsApp (wa.me/...)" />
                  </div>

                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Портфолио</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.portfolio.map((src, idx) => (
                        <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-100 bg-gray-50 group">
                          <img src={normalizeAssetUrl(src)} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removePortfolioImage(id, idx)}
                            className="absolute inset-0 bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      ))}
                      <label className={`w-16 h-16 flex items-center justify-center rounded-xl border-2 border-dashed text-xs ${isPortfolioUploading ? 'bg-gray-100 text-gray-400 border-gray-200' : 'border-gray-300 text-gray-400 cursor-pointer hover:bg-gray-50'}`}>
                        <i className={`fas ${isPortfolioUploading ? 'fa-spinner fa-spin' : 'fa-plus'}`}></i>
                        <input type="file" accept="image/*" className="hidden" disabled={isPortfolioUploading} onChange={(e) => { uploadPortfolioImage(id, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => saveMeta(id)} disabled={isSaving} className={`px-5 py-2.5 rounded-2xl font-black text-xs uppercase ${isSaving ? 'bg-gray-100 text-gray-400' : 'bg-[#1D2B49] text-white hover:bg-[#152036]'}`}>
                      {isSaving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                    <button type="button" onClick={() => deleteById(id)} disabled={isDeleting} className={`px-5 py-2.5 rounded-2xl font-black text-xs uppercase ${isDeleting ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
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
  );
};

export const DESIGNER_ADMIN_LABELS: PartnersAdminLabels = {
  heading: 'Дизайнеры',
  addSectionTitle: 'Добавить дизайнера',
  addButton: 'Добавить дизайнера',
  addButtonBusy: 'Создание...',
  newNamePlaceholder: 'Имя дизайнера',
  namePlaceholder: 'Имя',
  positionPlaceholder: 'Должность (например, Ведущий дизайнер)',
  bioPlaceholder: 'Описание / о дизайнере',
  emptyText: 'Дизайнеров пока нет',
  nameRequired: 'Введите имя дизайнера',
  deleteConfirm: 'Удалить дизайнера?',
  photoPlaceholderIcon: 'fa-user',
};

export const BRIGADE_ADMIN_LABELS: PartnersAdminLabels = {
  heading: 'Строительные бригады',
  addSectionTitle: 'Добавить бригаду',
  addButton: 'Добавить бригаду',
  addButtonBusy: 'Создание...',
  newNamePlaceholder: 'Название бригады',
  namePlaceholder: 'Название бригады',
  positionPlaceholder: 'Специализация (например, Монтаж сантехники под ключ)',
  bioPlaceholder: 'Описание / о бригаде',
  emptyText: 'Бригад пока нет',
  nameRequired: 'Введите название бригады',
  deleteConfirm: 'Удалить бригаду?',
  photoPlaceholderIcon: 'fa-helmet-safety',
};

export default PartnersAdminTab;
