import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';
import { Radio, Compass, ShieldCheck } from 'lucide-react';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-50">
        {/* Navigation Bar */}
        <header className="bg-slate-900 text-white border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center font-bold">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight">TrekLink</span>
                <span className="text-xs text-emerald-400 ml-2 font-mono">FA26SE159</span>
              </div>
            </div>

            <nav className="flex items-center gap-6 text-sm font-medium text-slate-300">
              <Link to="/" className="hover:text-white transition flex items-center gap-1.5 text-white">
                <Compass className="w-4 h-4" /> Operations
              </Link>
              <span className="text-slate-600">|</span>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> FSD + Leaflet + Tailwind
              </span>
            </nav>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
};
