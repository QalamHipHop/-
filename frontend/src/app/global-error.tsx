'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background text-foreground">
          <h1 className="text-3xl font-bold mb-2">Something went wrong</h1>
          <p className="text-muted-foreground mb-6 max-w-md text-center">
            We&apos;ve been notified. Try reloading, or come back in a moment.
          </p>
          {error.digest && <p className="text-xs text-muted-foreground mb-4 font-mono">{error.digest}</p>}
          <Button onClick={reset}>Try again</Button>
        </div>
      </body>
    </html>
  );
}
