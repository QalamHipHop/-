'use client';

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from './toast';
import { useToast } from './toast-provider';
import { CheckCircle2, AlertCircle, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertCircle,
} as const;

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, variant, action, ...props }) => {
        const Icon = ICONS[(variant || 'default') as keyof typeof ICONS] || Info;
        return (
          <Toast
            key={id}
            variant={variant === 'destructive' ? 'destructive' : variant === 'success' ? 'success' : 'default'}
            {...props}
            onOpenChange={(open) => !open && dismiss(id)}
            className={cn('flex items-start gap-3')}
          >
            <Icon
              className={cn(
                'h-5 w-5 mt-0.5 shrink-0',
                variant === 'destructive' && 'text-destructive-foreground',
                variant === 'success' && 'text-success'
              )}
            />
            <div className="grid gap-1 flex-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
