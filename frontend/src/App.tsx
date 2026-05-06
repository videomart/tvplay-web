import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/auth.store'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import ChannelsPage from './pages/channels/ChannelsPage'
import ClientsPage from './pages/clients/ClientsPage'
import ClipTypesPage from './pages/clip-types/ClipTypesPage'
import ClipsPage from './pages/clips/ClipsPage'
import PlayoutPage from './pages/playout/PlayoutPage'
import PlaylistsListPage from './pages/playlists/PlaylistsListPage'
import PlaylistEditorPage from './pages/playlists/PlaylistEditorPage'
import StreamOutputsPage from './pages/stream-outputs/StreamOutputsPage'
import InputSourcesPage from './pages/input-sources/InputSourcesPage'
import LogsPage from './pages/logs/LogsPage'
import UsersPage from './pages/users/UsersPage'
import SettingsPage from './pages/settings/SettingsPage'
import GraphicsPage from './pages/graphics/GraphicsPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
          <Route path="playlists"        element={<PlaylistsListPage />} />
          <Route path="playlists/:id"    element={<PlaylistEditorPage />} />
          <Route path="channels"         element={<ChannelsPage />} />
          <Route path="clients"          element={<ClientsPage />} />
          <Route path="clip-types"       element={<ClipTypesPage />} />
          <Route path="clips"            element={<ClipsPage />} />
          <Route path="stream-outputs"   element={<StreamOutputsPage />} />
          <Route path="input-sources"    element={<InputSourcesPage />} />
          <Route path="logs"             element={<LogsPage />} />
          <Route path="users"            element={<UsersPage />} />
          <Route path="settings"         element={<SettingsPage />} />
          <Route path="graphics"         element={<GraphicsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
