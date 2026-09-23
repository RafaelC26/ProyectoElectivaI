import { Navigate, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { useRealtime } from './hooks/useRealtime';
import { DashboardPage } from './pages/DashboardPage';
import { DebugPage } from './pages/DebugPage';
import { SimulatorPage } from './pages/SimulatorPage';
import { SystemPage } from './pages/SystemPage';

export function App() {
  useRealtime();
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-[1680px] px-4 py-4 sm:px-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/simulator" element={<SimulatorPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/debug" element={<DebugPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-[1680px] px-6 pb-6 text-[11px] text-ink-3">
        UPTC Seccional Sogamoso · Tendencias Modernas de Bases de Datos · Grupo 4 — datos simulados con fines
        académicos.
      </footer>
    </div>
  );
}
