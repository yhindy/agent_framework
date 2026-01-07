/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 *
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns The new debounced function with cancel and flush methods
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): T & { cancel: () => void; flush: () => void } {
  let timeout: NodeJS.Timeout | null = null
  let lastArgs: Parameters<T> | null = null

  const debounced = (...args: Parameters<T>) => {
    lastArgs = args
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      func(...args)
      lastArgs = null
    }, wait)
  }

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
      lastArgs = null
    }
  }

  debounced.flush = () => {
    if (timeout && lastArgs) {
      clearTimeout(timeout)
      func(...lastArgs)
      timeout = null
      lastArgs = null
    }
  }

  return debounced as T & { cancel: () => void; flush: () => void }
}
