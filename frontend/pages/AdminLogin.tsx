
import React, { useState } from 'react';
import { adminLogin, setAdminToken } from '../services/api';

interface AdminLoginProps {
  onLogin: () => void;
}

const AdminLogin: React.FC<AdminLoginProps> = ({ onLogin }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await adminLogin(password);
      setAdminToken(token);
      onLogin();
    } catch (e: any) {
      setError(e?.message || 'Неверный пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="bg-white p-12 rounded-[40px] shadow-2xl max-w-md w-full border border-gray-100">
        <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-8 text-[#1D2B49] text-3xl">
          <i className="fas fa-lock"></i>
        </div>
        <h2 className="text-3xl font-black text-[#1D2B49] text-center mb-2 uppercase tracking-tighter">Вход в панель</h2>
        <p className="text-gray-400 text-center mb-8 font-medium">Только для администраторов Bathroom Design</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            <input
              type="password"
              placeholder="Введите пароль..."
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              className={`w-full bg-gray-50 border ${error ? 'border-red-300 ring-4 ring-red-50' : 'border-gray-200'} rounded-2xl px-6 py-4 outline-none focus:ring-4 focus:ring-[#CEA549]/20 transition-all`}
            />
            {error && <p className="text-red-500 text-xs font-bold mt-2 ml-4 uppercase tracking-wider">{error}</p>}
          </div>
          <button
            disabled={loading}
            className={`w-full py-5 font-black rounded-2xl transition-all uppercase tracking-widest text-sm ${loading ? 'bg-gray-200 text-gray-400' : 'bg-[#1D2B49] hover:bg-[#152036] text-white'}`}
          >
            {loading ? '...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
