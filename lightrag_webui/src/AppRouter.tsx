import '@/lib/extensions'; // Import all global extensions
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { useAuthStore } from '@/stores/state'
import { navigationService } from '@/services/navigation'
import { Toaster } from 'sonner'
import { getAuthStatus } from '@/api/lightrag'
import App from './App'
import LoginPage from '@/features/LoginPage'
import ThemeProvider from '@/components/ThemeProvider'

const AppContent = () => {
  const [initializing, setInitializing] = useState(true)
  const { isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const authCheckRef = useRef(false); // Prevent duplicate calls in Vite dev mode

  // Set navigate function for navigation service
  useEffect(() => {
    navigationService.setNavigate(navigate)
  }, [navigate])

  // Token validity check
  useEffect(() => {
    const checkAuth = async () => {
      // Prevent duplicate calls in Vite dev mode
      if (authCheckRef.current) {
        return;
      }
      authCheckRef.current = true;

      try {
        const token = localStorage.getItem('LIGHTRAG-API-TOKEN')

        // If no token, logout and show login page
        if (!token) {
          useAuthStore.getState().logout()
          setInitializing(false)
          return
        }

        // Verify token validity by calling auth-status endpoint
        try {
          const status = await getAuthStatus()
          
          // If auth is not configured and a new token is returned, use the new token
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

          // If auth is configured, check if we have a valid token
          // The getAuthStatus call succeeded, so token is valid
          if (status.auth_configured) {
            // Token is valid, keep current auth state
            // But verify that isAuthenticated is actually true
            if (!isAuthenticated) {
              // If store says not authenticated but we have a token, 
              // the token might be invalid - logout to be safe
              console.warn('Token exists but store shows not authenticated, logging out')
              useAuthStore.getState().logout()
            }
            setInitializing(false)
            return
          }

          // If we reach here, auth is not configured but no access token was returned
          // This shouldn't happen, but handle it gracefully
          setInitializing(false)
        } catch (error: any) {
          // If getAuthStatus fails (e.g., 401, network error), token is invalid or unreachable
          console.error('Token validation failed:', error)
          
          // Check if it's a 401 error specifically
          const isAuthError = error?.response?.status === 401 || 
                             error?.message?.includes('401') ||
                             error?.message?.includes('Authentication required')
          
          if (isAuthError) {
            // Clear invalid token
            useAuthStore.getState().logout()
          } else {
            // For other errors (network, timeout, etc.), check if we have a token
            // If we have a token but can't verify it, assume it's invalid
            const token = localStorage.getItem('LIGHTRAG-API-TOKEN')
            if (token) {
              console.warn('Cannot verify token due to error, logging out')
              useAuthStore.getState().logout()
            }
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
  }, [])

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
