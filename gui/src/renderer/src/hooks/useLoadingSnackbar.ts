import { useCallback, useRef } from 'react'
import { useSnackbar } from '../contexts/SnackbarContext'

interface ShowLoadingOptions {
  title: string
  messages: string[]
  rotationInterval?: number
}

export function useLoadingSnackbar() {
  const { addSnackbar, removeSnackbar } = useSnackbar()
  const activeSnackbarsRef = useRef<Set<string>>(new Set())

  const showLoading = useCallback(
    (options: ShowLoadingOptions): string => {
      const id = addSnackbar(options)
      activeSnackbarsRef.current.add(id)
      return id
    },
    [addSnackbar]
  )

  const hideLoading = useCallback(
    (id: string): void => {
      if (activeSnackbarsRef.current.has(id)) {
        removeSnackbar(id)
        activeSnackbarsRef.current.delete(id)
      }
    },
    [removeSnackbar]
  )

  return { showLoading, hideLoading }
}
