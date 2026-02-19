"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RecentRequests } from "../components/recent-requests";
import { RequestVolume } from "../components/request-volume";
import { useDashboardData } from "@/hooks/use-dashboard-data";

const METRICS = ["request_volume"];
const EXTRAS = [
  { key: "recent_requests", url: "/api/stats?metric=recent_requests&limit=50" },
];

function RequestsContent() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get("days") ?? "7", 10);
  const { data, loading } = useDashboardData(METRICS, days, EXTRAS);

  if (loading && Object.keys(data).length === 0) {
    return <div className="text-center py-20 text-muted-foreground">Loading request data...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Requests</h1>

      <RequestVolume data={data.request_volume ?? []} />

      <RecentRequests data={data.recent_requests ?? []} />
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-muted-foreground">Loading...</div>}>
      <RequestsContent />
    </Suspense>
  );
}
