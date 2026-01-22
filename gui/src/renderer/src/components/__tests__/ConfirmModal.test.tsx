import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ConfirmModal from '../ConfirmModal'

describe('ConfirmModal', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Confirm Action',
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('visibility', () => {
    it('renders nothing when closed', () => {
      render(<ConfirmModal {...defaultProps} isOpen={false} />)
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })

    it('renders title and message when open', () => {
      render(<ConfirmModal {...defaultProps} title="Delete?" message="Cannot undo." />)

      expect(screen.getByRole('heading', { name: 'Delete?' })).toBeInTheDocument()
      expect(screen.getByText('Cannot undo.')).toBeInTheDocument()
    })
  })

  describe('button customization', () => {
    it('uses default button labels', () => {
      render(<ConfirmModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    it('uses custom button labels', () => {
      render(<ConfirmModal {...defaultProps} confirmText="Delete" cancelText="Keep" />)

      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
    })

    it('applies danger variant to confirm button', () => {
      render(<ConfirmModal {...defaultProps} confirmVariant="danger" />)
      expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('danger')
    })
  })

  describe('interactions', () => {
    it('calls onConfirm when confirm button clicked', () => {
      const onConfirm = vi.fn()
      render(<ConfirmModal {...defaultProps} onConfirm={onConfirm} />)

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when cancel button clicked', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when overlay clicked', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(document.querySelector('.modal-overlay')!)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('does not call onCancel when modal content clicked', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(document.querySelector('.modal-content')!)

      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('loading state', () => {
    it('disables both buttons and shows Processing text', () => {
      render(<ConfirmModal {...defaultProps} isLoading={true} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    })

    it('prevents overlay dismiss while loading', () => {
      const onCancel = vi.fn()
      render(<ConfirmModal {...defaultProps} onCancel={onCancel} isLoading={true} />)

      fireEvent.click(document.querySelector('.modal-overlay')!)

      expect(onCancel).not.toHaveBeenCalled()
    })
  })
})
