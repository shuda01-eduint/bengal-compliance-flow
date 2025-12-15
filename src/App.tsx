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
import DepartmentsPage from "./pages/DepartmentsPage";
import RulesPage from "./pages/RulesPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import AdminBalancesPage from "./pages/AdminBalancesPage";
import StockExchangeDataPage from "./pages/StockExchangeDataPage";
import TradeHistoryPage from "./pages/TradeHistoryPage";
import SecuritiesPage from "./pages/SecuritiesPage";
import PortfolioPage from "./pages/PortfolioPage";
import UserManagementPage from "./pages/UserManagementPage";
import AgentsPage from "./pages/AgentsPage";
import InvestorsPage from "./pages/InvestorsPage";
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
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
            <Route path="/activity" element={<ProtectedRoute><ActivityPage /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute><EmployeesPage /></ProtectedRoute>} />
            <Route path="/departments" element={<ProtectedRoute><DepartmentsPage /></ProtectedRoute>} />
            <Route path="/rules" element={<ProtectedRoute><RulesPage /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/admin/balances" element={<ProtectedRoute><AdminBalancesPage /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute><UserManagementPage /></ProtectedRoute>} />
            <Route path="/stock-exchange" element={<ProtectedRoute><StockExchangeDataPage /></ProtectedRoute>} />
            <Route path="/trade-history" element={<ProtectedRoute><TradeHistoryPage /></ProtectedRoute>} />
            <Route path="/securities" element={<ProtectedRoute><SecuritiesPage /></ProtectedRoute>} />
            <Route path="/portfolio" element={<ProtectedRoute><PortfolioPage /></ProtectedRoute>} />
            <Route path="/agents" element={<ProtectedRoute><AgentsPage /></ProtectedRoute>} />
            <Route path="/investors" element={<ProtectedRoute><InvestorsPage /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
