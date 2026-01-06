import { useSnackbar } from '../contexts/SnackbarContext'
import LoadingSnackbar from './LoadingSnackbar'
import './LoadingSnackbar.css'

function SnackbarContainer() {
  const { snackbars } = useSnackbar()

  if (snackbars.length === 0) {
    return null
  }

  return (
    <div className="snackbar-container">
      {snackbars.map((snackbar) => (
        <LoadingSnackbar
          key={snackbar.id}
          title={snackbar.title}
          messages={snackbar.messages}
          rotationInterval={snackbar.rotationInterval}
        />
      ))}
    </div>
  )
}

export default SnackbarContainer
