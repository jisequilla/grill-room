import { AgentNativeIcon } from "@agent-native/core/client/agent-native-icon";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconDatabase,
  IconFlame,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { NavLink } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_NAME, APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const NAV_ITEMS = [
  { to: "/", labelKey: "navigation.sessions", icon: IconFlame, end: true },
  {
    to: "/database",
    labelKey: "navigation.database",
    icon: IconDatabase,
    end: false,
  },
  {
    to: "/settings",
    labelKey: "navigation.settings",
    icon: IconSettings,
    end: false,
  },
] as const;

function NavItems({ collapsed }: { collapsed: boolean }) {
  const t = useT();

  return (
    <ul className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0.5 px-2")}>
      {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => {
        const label = t(labelKey);
        const link = (
          <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                collapsed
                  ? "size-10 justify-center rounded-md"
                  : "h-10 w-full gap-3 rounded-lg px-3 text-sm font-medium",
              )
            }
            aria-label={collapsed ? label : undefined}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.8} />
            <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
          </NavLink>
        );

        return (
          <li key={to}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const t = useT();
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;
  const collapseButton = collapsible ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label={
            collapsed
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")
          }
        >
          <ToggleIcon className="size-4" strokeWidth={1.8} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed
          ? t("navigation.expandSidebar")
          : t("navigation.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;
  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label={t("root.commandSearch")}
          className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <IconSearch className="size-4" strokeWidth={1.8} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("root.commandSearch")}</TooltipContent>
    </Tooltip>
  );

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-12" : "w-full",
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center",
          collapsed ? "justify-center px-1" : "gap-1 px-3",
        )}
      >
        {collapsed ? (
          collapseButton
        ) : (
          <>
            <NavLink
              to="/"
              end
              className="flex min-w-0 flex-1 items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <AgentNativeIcon
                aria-hidden="true"
                className="h-3.5 w-6 shrink-0 text-sidebar-accent-foreground"
              />
              <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">
                {APP_TITLE}
              </span>
            </NavLink>
            {searchButton}
            {collapseButton}
          </>
        )}
      </div>

      <nav
        aria-label={t("navigation.navigation")}
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          collapsed ? "items-center gap-1 px-1 py-2" : "pt-1",
        )}
      >
        <NavItems collapsed={collapsed} />
        {collapsed ? searchButton : null}
      </nav>

      <div className="mt-auto shrink-0 p-2">
        <OrgSwitcher
          reserveSpace
          compact={collapsed}
          currentAppId={APP_NAME}
          className={
            collapsed
              ? "size-8 bg-transparent p-0 hover:bg-sidebar-accent"
              : "h-11 rounded-lg bg-transparent px-3 py-2 text-sm text-sidebar-accent-foreground hover:bg-sidebar-accent"
          }
        />
      </div>
    </aside>
  );
}
