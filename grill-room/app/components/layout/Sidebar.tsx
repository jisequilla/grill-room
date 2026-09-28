import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconDatabase,
  IconFolders,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconListDetails,
  IconPlus,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { NavLink } from "react-router";

import { GrateMark } from "@/components/brand/grate-mark";
import { useNewSession } from "@/components/sessions/new-session-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Called when a control opens something over the page, so a sheet hosting the sidebar can close first. */
  onNavigate?: () => void;
}

const RECENT_LIMIT = 5;

const NAV_ITEMS = [
  {
    to: "/",
    labelKey: "navigation.sessions",
    icon: IconListDetails,
    end: true,
  },
  {
    to: "/projects",
    labelKey: "navigation.projects",
    icon: IconFolders,
    end: false,
  },
] as const;

const FOOTER_ITEMS = [
  {
    to: "/settings",
    labelKey: "navigation.settings",
    icon: IconSettings,
    end: false,
  },
  {
    to: "/database",
    labelKey: "navigation.database",
    icon: IconDatabase,
    end: false,
  },
] as const;

type NavEntry = (typeof NAV_ITEMS)[number] | (typeof FOOTER_ITEMS)[number];

function NavItems({
  collapsed,
  items,
  small = false,
}: {
  collapsed: boolean;
  items: readonly NavEntry[];
  small?: boolean;
}) {
  const t = useT();

  return (
    <ul className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0.5 px-2")}>
      {items.map(({ to, labelKey, icon: Icon, end }) => {
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
                  : small
                    ? "h-8 w-full gap-3 rounded-lg px-3 text-xs font-medium"
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

function RecentSessions() {
  const t = useT();
  const { data: sessions } = useActionQuery("list-sessions", {});
  const recent = (sessions ?? [])
    .filter((session) => session.state !== "confirmed")
    .slice(0, RECENT_LIMIT);

  if (recent.length === 0) return null;

  return (
    <section className="mt-3 min-h-0 px-2">
      <h2 className="px-3 pb-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {t("navigation.recent")}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {recent.map((session) => (
          <li key={session.id}>
            <NavLink
              to={`/sessions/${session.id}`}
              data-testid="recent-session"
              className={({ isActive }) =>
                cn(
                  "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                )
              }
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  session.state === "done-proposed"
                    ? "bg-owed"
                    : "bg-frontier",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{session.title}</span>
              {session.looseEndCount > 0 ? (
                <span className="shrink-0 font-mono text-xs text-owed">
                  {t("navigation.owedCount", { count: session.looseEndCount })}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
  onNavigate,
}: SidebarProps) {
  const t = useT();
  const newSession = useNewSession();
  const openNewSession = () => {
    onNavigate?.();
    newSession.open();
  };
  const newSessionLabel = t("navigation.newSession");
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
              className="flex min-w-0 flex-1 items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <GrateMark
                aria-hidden="true"
                className="size-5 shrink-0 text-sidebar-accent-foreground"
              />
              <span className="truncate font-mono text-[15px] font-medium text-sidebar-accent-foreground">
                grill room
              </span>
            </NavLink>
            {searchButton}
            {collapseButton}
          </>
        )}
      </div>

      {collapsed ? (
        <NavLink
          to="/"
          end
          aria-label="Grill Room"
          className="mx-auto flex size-10 items-center justify-center rounded-md text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <GrateMark aria-hidden="true" className="size-5" />
        </NavLink>
      ) : null}

      <div className={cn("shrink-0", collapsed ? "flex justify-center py-1" : "px-2 pb-2 pt-1")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                data-testid="sidebar-new-session"
                aria-label={newSessionLabel}
                onClick={openNewSession}
                className="size-10"
              >
                <IconPlus className="size-4 text-primary" strokeWidth={2} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{newSessionLabel}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            type="button"
            variant="secondary"
            data-testid="sidebar-new-session"
            onClick={openNewSession}
            className="w-full justify-start gap-3 px-3"
          >
            <IconPlus className="size-4 text-primary" strokeWidth={2} />
            {newSessionLabel}
          </Button>
        )}
      </div>

      <nav
        aria-label={t("navigation.navigation")}
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          collapsed ? "items-center gap-1 px-1 py-2" : "pt-1",
        )}
      >
        <NavItems collapsed={collapsed} items={NAV_ITEMS} />
        {collapsed ? searchButton : <RecentSessions />}
      </nav>

      <div className="mt-auto shrink-0 p-2">
        <div className={collapsed ? "flex justify-center pb-1" : "pb-1"}>
          <NavItems collapsed={collapsed} items={FOOTER_ITEMS} small />
        </div>
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
