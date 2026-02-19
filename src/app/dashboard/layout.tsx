"use client";

import { Suspense } from "react";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TimeRangeSelector } from "@/components/time-range-selector";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarInset>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 !h-4" />
        <div className="flex-1" />
        <Suspense>
          <TimeRangeSelector />
        </Suspense>
      </header>
      <main className="flex-1 p-6">
        {children}
      </main>
    </SidebarInset>
  );
}
