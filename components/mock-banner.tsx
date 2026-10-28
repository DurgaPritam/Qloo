import { MOCK_BANNER } from "@/lib/mock-mode";

import { Banner } from "./ui";

/** Fixed on every page in mock mode, so sample data can never pass for Qloo results. */
export function MockBanner() {
  return (
    <div data-mock-banner className="sticky top-0 z-50 bg-bg px-panel pt-2 print:static">
      <div className="mx-auto max-w-[1280px]">
        <Banner tone="warn">
          <span className="font-mono text-label uppercase tracking-[0.08em]">{MOCK_BANNER}</span>
        </Banner>
      </div>
    </div>
  );
}
