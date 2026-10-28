import type { ReactNode } from "react";
import { Suspense } from "react";

import { WorkspaceShell } from "@/components/workspace/shell";

/** Every workspace page sits in the App Shell: sidebar, search and notifications. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  );
}
