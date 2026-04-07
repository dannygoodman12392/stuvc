import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
