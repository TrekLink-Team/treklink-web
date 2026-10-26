import React from 'react';
import { BrowserRouter, Link } from 'react-router-dom';
import { Toast } from '../shared/ui/toast';
import { AccountMenu } from '../widgets/AccountMenu/AccountMenu';
import { MainNav } from '../widgets/MainNav/MainNav';
import { AlertBanner } from './AlertBanner';
import { AuthProvider } from './providers/AuthProvider';
import { LiveProvider } from './providers/LiveProvider';
import { AppRoutes } from './router';
import { Radio, Compass, ShieldCheck } from 'lucide-react';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
      <LiveProvider>
      <div className="min-h-screen flex flex-col bg-slate-50">
        <AlertBanner />
        {/* Navigation Bar */}
        <header className="bg-slate-900 text-white border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-y-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center font-bold">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight">TrekLink</span>
                <span className="text-xs text-emerald-400 ml-2 font-mono">FA26SE159</span>
              </div>
            </div>

            <nav className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm font-medium text-slate-300">
              <Link to="/" className="hover:text-white transition flex items-center gap-1.5 text-white">
                <Compass className="w-4 h-4" /> Operations
              </Link>
              <MainNav />
              <span className="hidden text-slate-600 xl:inline">|</span>
              <span className="hidden text-xs text-slate-400 xl:flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> FSD + Leaflet + Tailwind
              </span>
              <AccountMenu />
            </nav>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <AppRoutes />
        </main>
        <Toast />
      </div>
      </LiveProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};
