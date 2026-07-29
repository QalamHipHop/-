'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type Time, type CandlestickData } from 'lightweight-charts';
import { useTheme } from 'next-themes';

export interface Candle {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandlestickChartProps {
  data: Candle[];
  height?: number;
  volumeData?: Array<{ time: Time; value: number; color?: string }>;
  onCrosshairMove?: (price: number | null) => void;
}

export function CandlestickChart({ data, height = 400, volumeData, onCrosshairMove }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;
    const isDark = resolvedTheme === 'dark';
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: isDark ? '#9ca3af' : '#475569',
        fontFamily: 'var(--font-sans)',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' },
        horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
      height,
    });

    const series = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: isDark ? 'rgba(38, 161, 123, 0.4)' : 'rgba(38, 161, 123, 0.5)',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volumeSeries;

    if (onCrosshairMove) {
      chart.subscribeCrosshairMove((param) => {
        const price = param.time && param.seriesData.get(series) ? (param.seriesData.get(series) as CandlestickData).close : null;
        onCrosshairMove(typeof price === 'number' ? price : null);
      });
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, [height, resolvedTheme, onCrosshairMove]);

  useEffect(() => {
    if (seriesRef.current && data.length) {
      seriesRef.current.setData(data as CandlestickData[]);
    }
  }, [data]);

  useEffect(() => {
    if (volumeRef.current && volumeData) {
      volumeRef.current.setData(volumeData);
    }
  }, [volumeData]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
