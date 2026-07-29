'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, Droplets, Flame } from 'lucide-react';

interface BondingCurveMeterProps {
  progress: number;
  currentPrice: number;
  nextThreshold: number;
  raised: number;
  target: number;
  graduated: boolean;
}

export function BondingCurveMeter({
  progress,
  currentPrice,
  nextThreshold,
  raised,
  target,
  graduated,
}: BondingCurveMeterProps) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => !p), 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Flame className={`h-4 w-4 text-orange-500 ${pulse ? 'animate-pulse' : ''}`} />
            Bonding Curve Progress
          </h3>
          {graduated ? (
            <span className="text-xs font-medium text-success">Graduated</span>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">Pre-graduation</span>
          )}
        </div>

        <div>
          <div className="flex justify-between text-sm mb-1">
            <span>{progress.toFixed(1)}%</span>
            <span className="text-muted-foreground">100% → DEX liquidity</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat icon={<TrendingUp className="h-4 w-4" />} label="Current price" value={`$${currentPrice.toFixed(currentPrice < 0.01 ? 6 : 4)}`} />
          <Stat icon={<Droplets className="h-4 w-4" />} label="Next threshold" value={`$${nextThreshold.toFixed(4)}`} />
          <Stat label="Raised" value={`$${raised.toLocaleString()}`} />
          <Stat label="Target" value={`$${target.toLocaleString()}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
        {icon} {label}
      </div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  );
}
