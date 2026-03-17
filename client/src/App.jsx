import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Pipeline from './pages/Pipeline';
import FounderDetail from './pages/FounderDetail';
import AddFounder from './pages/AddFounder';
import Assess from './pages/Assess';
import AssessmentDetail from './pages/AssessmentDetail';
import AskStu from './pages/AskStu';
import Placeholder from './pages/Placeholder';

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
      <Route path="/ask" element={<ProtectedRoute><AskStu /></ProtectedRoute>} />
      <Route path="/" element={<ProtectedRoute><Pipeline /></ProtectedRoute>} />
      <Route path="/founders/new" element={<ProtectedRoute><AddFounder /></ProtectedRoute>} />
      <Route path="/founders/:id" element={<ProtectedRoute><FounderDetail /></ProtectedRoute>} />
      <Route path="/assess" element={<ProtectedRoute><Assess /></ProtectedRoute>} />
      <Route path="/assess/:id" element={<ProtectedRoute><AssessmentDetail /></ProtectedRoute>} />
      <Route path="/portfolio" element={<ProtectedRoute><Placeholder title="Portfolio" /></ProtectedRoute>} />
      <Route path="/fund" element={<ProtectedRoute><Placeholder title="Fund Analytics" /></ProtectedRoute>} />
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
