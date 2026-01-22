import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ConfirmModal from '../ConfirmModal'

describe('ConfirmModal', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders nothing when isOpen is false', () => {
      render(<ConfirmModal {...defaultProps} isOpen={false} />)

      expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument()
    })

    it('renders modal when isOpen is true', () => {
      render(<ConfirmModal {...defaultProps} />)

      expect(screen.getByText('Confirm Action')).toBeInTheDocument()
      expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument()
    })

    it('renders title and message correctly', () => {
      render(
        <ConfirmModal
          {...defaultProps}
          title="Delete Item"
          message="This action cannot be undone."
        />
      )

      expect(screen.getByText('Delete Item')).toBeInTheDocument()
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
    })

    it('renders default button text when not specified', () => {
      render(<ConfirmModal {...defaultProps} />)

      expect(screen.getByText('Confirm')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('renders custom button text when specified', () => {
      render(
        <ConfirmModal
          {...defaultProps}
          confirmText="Delete"
          cancelText="Keep"
        />
      )

      expect(screen.getByText('Delete')).toBeInTheDocument()
      expect(screen.getByText('Keep')).toBeInTheDocument()
    })
  })

  describe('button variants', () => {
    it('applies primary variant by default', () => {
      render(<ConfirmModal {...defaultProps} />)

      const confirmButton = screen.getByText('Confirm')
      expect(confirmButton).toHaveClass('primary')
    })

    it('applies danger variant when specified', () => {
      render(<ConfirmModal {...defaultProps} confirmVariant="danger" />)

      const confirmButton = screen.getByText('Confirm')
      expect(confirmButton).toHaveClass('danger')
    })
  })

  describe('interactions', () => {
    it('calls onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn()
      render(<ConfirmModal {...defaultProps} onConfirm={onConfirm} />)

      fireEvent.click(screen.getByText('Confirm'))

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(screen.getByText('Cancel'))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when clicking overlay', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} />)

      // Click the overlay (modal-overlay class)
      const overlay = document.querySelector('.modal-overlay')
      fireEvent.click(overlay!)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('does not call onCancel when clicking modal content', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} />)

      // Click the modal content (should stop propagation)
      const content = document.querySelector('.modal-content')
      fireEvent.click(content!)

      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('loading state', () => {
    it('disables buttons when isLoading is true', () => {
      render(<ConfirmModal {...defaultProps} isLoading={true} />)

      expect(screen.getByText('Cancel')).toBeDisabled()
      expect(screen.getByText('Processing...')).toBeDisabled()
    })

    it('shows Processing... text when loading', () => {
      render(<ConfirmModal {...defaultProps} isLoading={true} />)

      expect(screen.getByText('Processing...')).toBeInTheDocument()
      expect(screen.queryByText('Confirm')).not.toBeInTheDocument()
    })

    it('does not call onCancel when clicking overlay while loading', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} isLoading={true} />)

      const overlay = document.querySelector('.modal-overlay')
      fireEvent.click(overlay!)

      expect(onCancel).not.toHaveBeenCalled()
    })

    it('buttons are enabled when not loading', () => {
      render(<ConfirmModal {...defaultProps} isLoading={false} />)

      expect(screen.getByText('Cancel')).not.toBeDisabled()
      expect(screen.getByText('Confirm')).not.toBeDisabled()
    })
  })

  describe('accessibility', () => {
    it('has proper heading structure', () => {
      render(<ConfirmModal {...defaultProps} />)

      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading).toHaveTextContent('Confirm Action')
    })

    it('buttons are properly labeled', () => {
      render(<ConfirmModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })
  })
})
