import { createPortal } from 'react-dom'
import { getModifierSymbol } from '../hooks/useKeyboardShortcuts'
import './KeyboardShortcutsHelp.css'

interface KeyboardShortcutsHelpProps {
  isOpen: boolean
  onClose: () => void
}

function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps): React.ReactPortal | null {
  if (!isOpen) return null

  const mod = getModifierSymbol()

  const shortcuts = [
    { keys: [mod, 'N'], description: 'New Minion' },
    { keys: [mod, 'Shift', 'N'], description: 'New Super Minion' },
    { keys: [mod, 'O'], description: 'Open Project' },
    { keys: [mod, 'T'], description: 'Teleport from Cloud' },
    { keys: [mod, '\u2191'], description: 'Previous Minion' },
    { keys: [mod, '\u2193'], description: 'Next Minion' },
    { keys: ['Escape'], description: 'Close Dialog' },
    { keys: [mod, '/'], description: 'Show Shortcuts' }
  ]

  return createPortal(
    <div className="shortcuts-help-overlay" onClick={onClose}>
      <div
        className="shortcuts-help-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-help-header">
          <h3 id="shortcuts-help-title">Keyboard Shortcuts</h3>
        </div>
        <div className="shortcuts-help-body">
          <ul className="shortcuts-list">
            {shortcuts.map((shortcut, index) => (
              <li key={index} className="shortcut-row">
                <span className="shortcut-keys">
                  {shortcut.keys.map((key, keyIndex) => (
                    <span key={keyIndex}>
                      <kbd className="key-cap">{key}</kbd>
                      {keyIndex < shortcut.keys.length - 1 && <span className="key-separator">+</span>}
                    </span>
                  ))}
                </span>
                <span className="shortcut-description">{shortcut.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default KeyboardShortcutsHelp
