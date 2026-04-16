import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/Onboarding';
import Pipeline from './pages/Pipeline';
import FounderDetail from './pages/FounderDetail';
import AddFounder from './pages/AddFounder';
import Assess from './pages/Assess';
import AssessmentDetail from './pages/AssessmentDetail';
import AskStu from './pages/AskStu';
import Placeholder from './pages/Placeholder';
import Settings from './pages/Settings';
import Payment from './pages/Payment';
import PaymentSuccess from './pages/PaymentSuccess';
import Admin from './pages/Admin';
import TalentLayout from './components/TalentLayout';
import TalentHome from './pages/talent/TalentHome';
import TalentCriteria from './pages/talent/TalentCriteria';
import TalentPortfolio from './pages/talent/TalentPortfolio';
import TalentPortfolioDetail from './pages/talent/TalentPortfolioDetail';
import TalentRoles from './pages/talent/TalentRoles';
import TalentRoleDetail from './pages/talent/TalentRoleDetail';
import TalentCandidates from './pages/talent/TalentCandidates';
import TalentCandidateDetail from './pages/talent/TalentCandidateDetail';
import TalentMatches from './pages/talent/TalentMatches';
import TalentTrash from './pages/talent/TalentTrash';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  // Payment gate — disabled until Stripe is configured
  // if (!user.has_paid) return <Navigate to="/payment" replace />;
  if (!user.onboarding_complete) return <Navigate to="/onboarding" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
      {/* Payment routes — disabled until Stripe is configured
      <Route path="/payment" element={
        !user ? <Navigate to="/login" replace /> :
        user.has_paid ? <Navigate to="/" replace /> :
        <Payment />
      } />
      <Route path="/payment/success" element={
        !user ? <Navigate to="/login" replace /> :
        <PaymentSuccess />
      } /> */}
      <Route path="/onboarding" element={
        !user ? <Navigate to="/login" replace /> :
        user.onboarding_complete ? <Navigate to="/" replace /> :
        <Onboarding />
      } />
      <Route path="/ask" element={<ProtectedRoute><AskStu /></ProtectedRoute>} />
      <Route path="/" element={user ? <ProtectedRoute><Pipeline /></ProtectedRoute> : <Landing />} />
      <Route path="/founders/new" element={<ProtectedRoute><AddFounder /></ProtectedRoute>} />
      <Route path="/founders/:id" element={<ProtectedRoute><FounderDetail /></ProtectedRoute>} />
      <Route path="/assess" element={<ProtectedRoute><Assess /></ProtectedRoute>} />
      <Route path="/assess/:id" element={<ProtectedRoute><AssessmentDetail /></ProtectedRoute>} />
      <Route path="/portfolio" element={<ProtectedRoute><Placeholder title="Portfolio" /></ProtectedRoute>} />
      <Route path="/fund" element={<ProtectedRoute><Placeholder title="Fund Analytics" /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
      <Route path="/talent" element={<ProtectedRoute><TalentLayout /></ProtectedRoute>}>
        <Route index element={<TalentHome />} />
        <Route path="portfolio" element={<TalentPortfolio />} />
        <Route path="portfolio/:id" element={<TalentPortfolioDetail />} />
        <Route path="roles" element={<TalentRoles />} />
        <Route path="roles/:id" element={<TalentRoleDetail />} />
        <Route path="candidates" element={<TalentCandidates />} />
        <Route path="candidates/:id" element={<TalentCandidateDetail />} />
        <Route path="matches" element={<TalentMatches />} />
        <Route path="criteria" element={<TalentCriteria />} />
        <Route path="trash" element={<TalentTrash />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
