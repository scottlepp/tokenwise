"use client";

import { useEffect, useState, useCallback } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface UseDashboardDataResult {
  data: Record<string, any>;
  loading: boolean;
}

interface ExtraFetch {
  key: string;
  url: string;
}

export function useDashboardData(
  metrics: string[],
  days: number,
  extras?: ExtraFetch[],
): UseDashboardDataResult {
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const fetches = metrics.map((m) =>
        fetch(`/api/stats?metric=${m}&days=${days}`).then((r) => r.json()),
      );

      const extraFetches = (extras ?? []).map((e) =>
        fetch(e.url).then((r) => r.json()),
      );

      const [metricResults, extraResults] = await Promise.all([
        Promise.all(fetches),
        Promise.all(extraFetches),
      ]);

      const result: Record<string, any> = {};
      metrics.forEach((m, i) => {
        result[m] = metricResults[i]?.data;
      });
      (extras ?? []).forEach((e, i) => {
        result[e.key] = extraResults[i]?.data;
      });

      setData(result);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [metrics.join(","), days, extras?.map((e) => e.url).join(",")]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading };
}
