'use client';

import * as React from 'react';

type ToastVariant = 'default' | 'success' | 'destructive' | 'warning';

export interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
  action?: React.ReactNode;
}

interface ToastEntry extends ToastInput {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ToastContextValue {
  toasts: ToastEntry[];
  toast: (t: ToastInput) => string;
  dismiss: (id?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let idCounter = 0;
const nextId = () => `t${++idCounter}`;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastEntry[]>([]);

  const dismiss = React.useCallback((id?: string) => {
    setToasts((prev) =>
      id === undefined ? prev.map((t) => ({ ...t, open: false })) : prev.filter((t) => t.id !== id)
    );
    if (id !== undefined) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 200);
    }
  }, []);

  const toast = React.useCallback((t: ToastInput) => {
    const id = nextId();
    setToasts((prev) => [
      ...prev,
      { id, open: true, duration: 4000, variant: 'default', ...t, onOpenChange: (o) => !o && dismiss(id) },
    ]);
    return id;
  }, [dismiss]);

  const value = React.useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
