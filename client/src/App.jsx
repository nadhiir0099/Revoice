import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import Workspace from './pages/Workspace';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';

function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="loader-container">
        <div className="loader">
          <div className="spinner"></div>
          <p>Initializing ReVoice...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/signup" element={<AuthPage />} />
      <Route
        path="/workspace"
        element={
          <ProtectedRoute>
            <Workspace />
          </ProtectedRoute>
        }
      />
      {/* Fallback for logged in users */}
      <Route path="/app" element={<Navigate to="/workspace" replace />} />
      {/* 404 redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
