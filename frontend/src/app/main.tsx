import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { startTheme } from '../shared/lib/theme';
import { App } from './App';
import { connectApiToSession } from './providers/registerApiAuth';
import { restoreSession } from './providers/restoreSession';
import './styles/index.css';

connectApiToSession();
void restoreSession();
startTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
