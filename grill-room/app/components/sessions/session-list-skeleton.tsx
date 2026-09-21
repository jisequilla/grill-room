import { Skeleton } from "@/components/ui/skeleton";

export function SessionListSkeleton() {
  return (
    <ul className="divide-y divide-border">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-3 px-2 py-3">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </li>
      ))}
    </ul>
  );
}
