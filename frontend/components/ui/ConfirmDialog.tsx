'use client'

import React, { useState, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmDialogProps {
  /** The title of the modal */
  title: string
  /** The descriptive text inside the modal */
  description: ReactNode
  /** The label for the confirm button */
  confirmText?: string
  /** The label for the cancel button. If null/undefined, behaves as an Alert with no cancel option. */
  cancelText?: string | null
  /** The variant style: destructive (red) or default (accent) */
  variant?: 'destructive' | 'default'
  
  /** Function to execute on confirm. Displays loading state if async. */
  onConfirm?: () => Promise<void> | void
  /** Function to execute on cancel/close. */
  onCancel?: () => void

  /** If provided, wraps an element that triggers the modal */
  trigger?: ReactNode

  /** For controlled state: Whether the modal is open */
  isOpen?: boolean
  /** For controlled state: Callback when open state changes (especially when user closes it) */
  onOpenChange?: (open: boolean) => void
}

export default function ConfirmDialog({
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "destructive",
  onConfirm,
  onCancel,
  trigger,
  isOpen: controlledIsOpen,
  onOpenChange,
}: ConfirmDialogProps) {
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Wajib untuk Portal di Next.js
  useEffect(() => {
    setMounted(true)
  }, [])

  const isControlled = controlledIsOpen !== undefined
  const isOpen = isControlled ? controlledIsOpen : uncontrolledIsOpen

  const setOpen = (open: boolean) => {
    if (!isControlled) {
      setUncontrolledIsOpen(open)
    }
    if (onOpenChange) {
      onOpenChange(open)
    }
  }

  const handleConfirm = async () => {
    if (onConfirm) {
      setIsExecuting(true)
      try {
        await onConfirm()
      } catch (e: any) {
        console.error("Confirm dialog action failed:", e)
      } finally {
        setIsExecuting(false)
      }
    }
    
    // Auto-close after confirming if successful or if just an alert
    setOpen(false)
  }

  const handleCancel = () => {
    if (onCancel) {
      onCancel()
    }
    setOpen(false)
  }

  const isAlertMode = !cancelText;

  const modalContent = isOpen ? (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
      onClick={() => !isExecuting && handleCancel()}
    >
      <div
        className={`bg-surface border w-full max-w-md rounded-lg flex flex-col overflow-hidden relative z-50 animate-in fade-in zoom-in-95 duration-200 ${
          variant === 'destructive' 
            ? 'shadow-[0_0_50px_rgba(239,68,68,0.15)] border-surface-border' 
            : 'shadow-[0_0_50px_rgba(184, 184, 184,0.15)] border-[rgba(184, 184, 184,0.2)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Konten Peringatan */}
        <div className="p-6 flex flex-col items-center text-center gap-4">
          <div className={`h-12 w-12 rounded-full flex items-center justify-center border ${
            variant === 'destructive'
              ? 'bg-red-500/10 border-red-500/20 text-red-500'
              : 'bg-[#B8B8B8]/10 border-[#B8B8B8]/20 text-[#B8B8B8]'
          }`}>
            <span className="material-symbols-outlined">
              {variant === 'destructive' ? 'warning' : 'info'}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-display text-white">{title}</h3>
            <p className="text-sm text-text-muted mt-2">
              {description}
            </p>
          </div>
        </div>

        {/* Tombol Aksi */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-surface-border bg-surface/50">
          {!isAlertMode && (
             <button
                onClick={handleCancel}
                disabled={isExecuting}
                className="px-4 py-2 text-sm text-text-muted hover:text-white transition-colors"
             >
                {cancelText}
             </button>
          )}
          
          <button
            onClick={handleConfirm}
            disabled={isExecuting}
            className={`px-4 py-2 rounded text-sm font-medium transition-all disabled:opacity-50 flex items-center gap-2 ${
              variant === 'destructive'
                ? 'bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white'
                : 'bg-[#B8B8B8]/10 border border-[#B8B8B8]/50 text-[#B8B8B8] hover:bg-[#D4D4D4] hover:text-[#0A0A0A] font-bold shadow-[0_0_15px_rgba(184, 184, 184,0.3)] hover:scale-[1.02]'
            }`}
          >
            {isExecuting ? (
               <div className="flex items-center gap-2">
                 <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                 Processing...
               </div>
            ) : (
               confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {trigger && React.isValidElement(trigger) ? (
        React.cloneElement(trigger as React.ReactElement<any>, {
          onClick: (e: any) => {
            e.stopPropagation();
            setOpen(true);
            if ((trigger as any).props.onClick) {
               (trigger as any).props.onClick(e);
            }
          }
        })
      ) : null}

      {/* Render Modal via Portal */}
      {mounted && createPortal(modalContent, document.body)}
    </>
  )
}
