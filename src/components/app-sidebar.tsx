"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  DollarSign,
  Activity,
  List,
  Settings,
  Zap,
  Radio,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

const dashboardItems = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Activity", href: "/dashboard/activity", icon: Radio },
  { title: "Costs", href: "/dashboard/costs", icon: DollarSign },
  { title: "Performance", href: "/dashboard/performance", icon: Activity },
  { title: "Requests", href: "/dashboard/requests", icon: List },
];

const configItems = [
  { title: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const days = searchParams.get("days");

  function buildHref(base: string) {
    if (days && base.startsWith("/dashboard")) {
      return `${base}?days=${days}`;
    }
    return base;
  }

  function isActive(href: string) {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          <div>
            <div className="font-bold text-lg leading-tight">CodeWise</div>
          </div>
        </Link>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dashboardItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)}>
                    <Link href={buildHref(item.href)}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Configuration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {configItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="text-xs text-muted-foreground">
          CodeWise v0.1.0
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
