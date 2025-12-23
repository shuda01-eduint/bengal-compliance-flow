import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import Index from "./pages/Index";
import ReportsPage from "./pages/ReportsPage";
import ActivityPage from "./pages/ActivityPage";
import EmployeesPage from "./pages/EmployeesPage";
import RulesPage from "./pages/RulesPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import AdminBalancesPage from "./pages/AdminBalancesPage";
import CEODashboardPage from "./pages/CEODashboardPage";
import TradeHistoryPage from "./pages/TradeHistoryPage";
import SecuritiesPage from "./pages/SecuritiesPage";
import InvestorsPage from "./pages/InvestorsPage";
import AccountingPage from "./pages/AccountingPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            {/* Public pages for all approved users */}
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/admin/balances" element={<ProtectedRoute><AdminBalancesPage /></ProtectedRoute>} />
            
            {/* Admin-only pages */}
            <Route path="/ceo-dashboard" element={<ProtectedRoute requireAdmin><CEODashboardPage /></ProtectedRoute>} />
            <Route path="/trade-history" element={<ProtectedRoute requireAdmin><TradeHistoryPage /></ProtectedRoute>} />
            <Route path="/securities" element={<ProtectedRoute requireAdmin><SecuritiesPage /></ProtectedRoute>} />
            <Route path="/accounting" element={<ProtectedRoute requireAdmin><AccountingPage /></ProtectedRoute>} />
            <Route path="/investors" element={<ProtectedRoute requireAdmin><InvestorsPage /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute requireAdmin><ReportsPage /></ProtectedRoute>} />
            <Route path="/activity" element={<ProtectedRoute requireAdmin><ActivityPage /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute requireAdmin><EmployeesPage /></ProtectedRoute>} />
            <Route path="/rules" element={<ProtectedRoute requireAdmin><RulesPage /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute requireAdmin><NotificationsPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute requireAdmin><SettingsPage /></ProtectedRoute>} />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
