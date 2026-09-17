import React, { useState } from 'react';
import { sendLead } from '../services/api';
import { formatKzPhone, isValidKzPhone, toPlainPhone } from '../utils/phone';

interface LeadFormProps {
  onSuccess?: () => void;
  /** Pre-filled request text, e.g. "Узнать цену: <товар> (арт. X)". */
  initialMessage?: string;
  submitLabel?: string;
}

const LeadForm: React.FC<LeadFormProps> = ({ onSuccess, initialMessage = '', submitLabel = 'Отправить заявку' }) => {
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadMessage, setLeadMessage] = useState(initialMessage);
  const [isSendingLead, setIsSendingLead] = useState(false);
  const [statusModal, setStatusModal] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidKzPhone(leadPhone)) {
      setStatusModal({ type: 'error', message: 'Введите номер в формате +7 (7XX) XXX-XX-XX' });
      return;
    }
    setIsSendingLead(true);
    try {
      await sendLead({
        name: leadName,
        phone: toPlainPhone(leadPhone),
        email: leadEmail.trim(),
        message: leadMessage || undefined,
      });
      setLeadName('');
      setLeadPhone('');
      setLeadEmail('');
      setLeadMessage(initialMessage);
      if (onSuccess) onSuccess();
      else setStatusModal({ type: 'success', message: 'Заявка отправлена!' });
    } catch (err: any) {
      setStatusModal({ type: 'error', message: err?.message || 'Ошибка при отправке' });
    } finally {
      setIsSendingLead(false);
    }
  };

  return (
    <>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Ваше имя (не обязательно)</label>
          <input
            type="text"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:border-[#CEA549] focus:ring-2 focus:ring-[#CEA549]/20 outline-none transition-all"
            placeholder="Александр"
            value={leadName}
            onChange={(e) => setLeadName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Телефон</label>
          <input
            type="tel"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:border-[#CEA549] focus:ring-2 focus:ring-[#CEA549]/20 outline-none transition-all"
            placeholder="+7 (___) ___-__-__"
            inputMode="tel"
            value={leadPhone}
            onChange={(e) => setLeadPhone(formatKzPhone(e.target.value))}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase mb-2">
            Email <span className="font-normal normal-case text-gray-300">— не обязательно</span>
          </label>
          <input
            type="email"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:border-[#CEA549] focus:ring-2 focus:ring-[#CEA549]/20 outline-none transition-all"
            placeholder="you@mail.com"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Сообщение</label>
          <textarea
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:border-[#CEA549] focus:ring-2 focus:ring-[#CEA549]/20 outline-none transition-all min-h-[110px]"
            placeholder="Коротко опишите запрос..."
            value={leadMessage}
            onChange={(e) => setLeadMessage(e.target.value)}
          />
        </div>
        <button
          disabled={isSendingLead}
          className={`w-full py-4 rounded-xl font-black uppercase tracking-widest text-sm transition-all ${
            isSendingLead ? 'bg-gray-200 text-gray-400' : 'bg-[#1D2B49] hover:bg-[#152036] text-white'
          }`}
        >
          {isSendingLead ? 'Отправка...' : submitLabel}
        </button>
      </form>

      {statusModal ? (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onClick={() => setStatusModal(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-gray-100 p-7" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-4 mb-5">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${statusModal.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                <i className={`fas ${statusModal.type === 'success' ? 'fa-check' : 'fa-exclamation-triangle'}`}></i>
              </div>
              <div>
                <div className="text-lg font-black text-[#1D2B49] uppercase tracking-tight">
                  {statusModal.type === 'success' ? 'Заявка отправлена' : 'Не удалось отправить'}
                </div>
                <div className="text-sm text-gray-500 mt-1">{statusModal.message}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStatusModal(null)}
              className={`w-full py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all ${statusModal.type === 'success' ? 'bg-[#1D2B49] text-white hover:bg-[#152036]' : 'bg-red-500 text-white hover:bg-red-600'}`}
            >
              Понятно
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default LeadForm;
