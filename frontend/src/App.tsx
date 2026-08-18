import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/auth.store'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/Login'
import ForgotPasswordPage from './pages/ForgotPassword'
import ResetPasswordPage from './pages/ResetPassword'
import DashboardPage from './pages/Dashboard'
import ChannelsPage from './pages/channels/ChannelsPage'
import ClientsPage from './pages/clients/ClientsPage'
import ClipTypesPage from './pages/clip-types/ClipTypesPage'

import PlayoutPage from './pages/playout/PlayoutPage'
import PlaylistsListPage from './pages/playlists/PlaylistsListPage'
import PlaylistEditorPage from './pages/playlists/PlaylistEditorPage'
import StreamOutputsPage from './pages/stream-outputs/StreamOutputsPage'
import InputSourcesPage from './pages/input-sources/InputSourcesPage'
import LogsPage from './pages/logs/LogsPage'
import UsersPage from './pages/users/UsersPage'
import SettingsPage from './pages/settings/SettingsPage'
import GraphicsPage from './pages/graphics/GraphicsPage'
import MediaFilesPage from './pages/media/MediaFilesPage'
import ClipsPage from './pages/clips/ClipsPage'
import GraphicTemplatesPage from './pages/graphic-templates/GraphicTemplatesPage'
import GraphicTemplateEditorPage from './pages/graphic-templates/GraphicTemplateEditorPage'
import MultiViewerPage from './pages/multi-viewer/MultiViewerPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Fora do AppLayout: página fullscreen sem sidebar */}
        <Route
          path="/multi-viewer"
          element={
            <PrivateRoute>
              <MultiViewerPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"        element={<DashboardPage />} />
          <Route path="playout"          element={<PlayoutPage />} />
          <Route path="roteiros"        element={<PlaylistsListPage />} />
          <Route path="roteiros/:id"    element={<PlaylistEditorPage />} />
          <Route path="channels"         element={<ChannelsPage />} />
          <Route path="clients"          element={<ClientsPage />} />
          <Route path="clip-types"       element={<ClipTypesPage />} />

          <Route path="stream-outputs"   element={<StreamOutputsPage />} />
          <Route path="input-sources"    element={<InputSourcesPage />} />
          <Route path="logs"             element={<LogsPage />} />
          <Route path="users"            element={<UsersPage />} />
          <Route path="settings"         element={<SettingsPage />} />
          <Route path="graphics"                    element={<GraphicsPage />} />
          <Route path="graphic-templates"           element={<GraphicTemplatesPage />} />
          <Route path="graphic-templates/:id"       element={<GraphicTemplateEditorPage />} />
          <Route path="media"                       element={<MediaFilesPage />} />
          <Route path="clips"                       element={<ClipsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
