import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

export interface Snackbar {
  id: string
  title: string
  messages: string[]
  rotationInterval?: number
}

interface SnackbarContextType {
  snackbars: Snackbar[]
  addSnackbar: (snackbar: Omit<Snackbar, 'id'>) => string
  removeSnackbar: (id: string) => void
}

const SnackbarContext = createContext<SnackbarContextType | null>(null)

let snackbarIdCounter = 0

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snackbars, setSnackbars] = useState<Snackbar[]>([])

  const addSnackbar = useCallback((snackbar: Omit<Snackbar, 'id'>) => {
    const id = `snackbar-${++snackbarIdCounter}`
    setSnackbars((prev) => [...prev, { ...snackbar, id }])
    return id
  }, [])

  const removeSnackbar = useCallback((id: string) => {
    setSnackbars((prev) => prev.filter((s) => s.id !== id))
  }, [])

  return (
    <SnackbarContext.Provider value={{ snackbars, addSnackbar, removeSnackbar }}>
      {children}
    </SnackbarContext.Provider>
  )
}

export function useSnackbar() {
  const context = useContext(SnackbarContext)
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider')
  }
  return context
}
