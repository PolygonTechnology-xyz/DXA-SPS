import { Routes, Route, Navigate } from 'react-router-dom'
import Landing from '@/views/Landing'
import Login from '@/views/Login'
import AppShell from '@/components/layout/AppShell'

export default function App() {
  return (
    <Routes>
      <Route path="/landing" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/projects" element={<AppShell />} />
      <Route path="/projects/list" element={<AppShell />} />
      <Route path="/knowledge" element={<AppShell />} />
      <Route path="/projects/:id" element={<Navigate to="overview" replace />} />
      <Route path="/projects/:id/:pane" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  )
}
