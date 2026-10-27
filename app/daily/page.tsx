import type { Metadata } from "next";

import { DailyGame } from "@/components/daily-game";
import { AppHeader, Page } from "@/components/ui";

export const metadata: Metadata = {
  title: "Takeover Daily · guess what Qloo knows",
  description: "A new fanbase every day. Guess its crossover partner, city and sponsor from Qloo taste data, then share your score.",
};

export default function DailyPage() {
  return (
    <Page>
      <AppHeader />
      <DailyGame />
    </Page>
  );
}
