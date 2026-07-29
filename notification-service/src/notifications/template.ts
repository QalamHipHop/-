import { Notification } from './notifications.types';

/**
 * Minimal Mustache-like template renderer for `{{var}}` placeholders.
 * Safe: unknown variables render as empty strings; no HTML escaping
 * (callers must pre-escape if needed).
 */
export function render(template: string, vars: Record<string, unknown> = {}): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const path = key.split('.');
    let cur: unknown = vars;
    for (const p of path) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return '';
      }
    }
    return cur == null ? '' : String(cur);
  });
}

export function buildBody(
  base: { subject?: string; body: string },
  data?: Record<string, unknown>,
): { subject?: string; body: string } {
  if (!data) return { subject: base.subject, body: base.body };
  return {
    subject: base.subject ? render(base.subject, data) : undefined,
    body: render(base.body, data),
  };
}

export function withDefaults(n: Notification): Notification {
  return {
    ...n,
    body: n.body,
  };
}
