import '@/lib/extensions'; // Import all global extensions
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/state'
import { navigationService } from '@/services/navigation'
import { getAuthStatus } from '@/api/lightrag'
import { Toaster } from 'sonner'
import App from './App'
import LoginPage from '@/features/LoginPage'
import ThemeProvider from '@/components/ThemeProvider'

const AppContent = () => {
  const [initializing, setInitializing] = useState(true)
  const { isAuthenticated } = useAuthStore()
  const navigate = useNavigate()

  // Set navigate function for navigation service
  useEffect(() => {
    navigationService.setNavigate(navigate)
  }, [navigate])

  // Token validity check
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('LIGHTRAG-API-TOKEN')

        // If no token, logout and show login page
        if (!token) {
          useAuthStore.getState().logout()
          setInitializing(false)
          return
        }

        // Verify token by calling auth-status API
        try {
          const status = await getAuthStatus()

          // If auth is not configured and a guest token is provided, use it
          if (!status.auth_configured && status.access_token) {
            useAuthStore.getState().login(
              status.access_token,
              true, // Guest mode
              status.core_version,
              status.api_version,
              status.webui_title || null,
              status.webui_description || null
            )
            setInitializing(false)
            return
          }

          // If auth is configured and we have a token, verify it's still valid
          // The getAuthStatus call will throw if token is invalid (handled by axios interceptor)
          // If it succeeds, token is valid
          if (status.auth_configured) {
            // Token is valid, ensure user is authenticated
            if (!isAuthenticated) {
              // Update auth state with version info if available
              const isGuestMode = status.auth_mode === 'disabled'
              useAuthStore.getState().login(
                token,
                isGuestMode,
                status.core_version,
                status.api_version,
                status.webui_title || null,
                status.webui_description || null
              )
            }
            setInitializing(false)
            return
          }

          // If we reach here, something unexpected happened
          setInitializing(false)
        } catch (error: any) {
          // Token is invalid or API call failed
          // If it's a 401 error, axios interceptor will handle navigation
          // We just need to clear the auth state
          if (error?.response?.status === 401) {
            console.log('Token is invalid (401), clearing auth state')
            useAuthStore.getState().logout()
            localStorage.removeItem('LIGHTRAG-API-TOKEN')
            // Don't navigate here, axios interceptor will handle it
          } else {
            console.error('Token validation failed:', error)
            useAuthStore.getState().logout()
            localStorage.removeItem('LIGHTRAG-API-TOKEN')
          }
          setInitializing(false)
        }
      } catch (error) {
        console.error('Auth initialization error:', error)
        useAuthStore.getState().logout()
        setInitializing(false)
      }
    }

    checkAuth()

    return () => {
    }
  }, [isAuthenticated])

  // Redirect effect for protected routes
  useEffect(() => {
    if (!initializing && !isAuthenticated) {
      const currentPath = window.location.hash.slice(1);
      if (currentPath !== '/login') {
        console.log('Not authenticated, redirecting to login');
        navigate('/login');
      }
    }
  }, [initializing, isAuthenticated, navigate]);

  // Show nothing while initializing
  if (initializing) {
    return null
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={isAuthenticated ? <App /> : null}
      />
    </Routes>
  )
}

const AppRouter = () => {
  return (
    <ThemeProvider>
      <Router>
        <AppContent />
        <Toaster
          position="bottom-center"
          theme="system"
          closeButton
          richColors
        />
      </Router>
    </ThemeProvider>
  )
}

export default AppRouter
