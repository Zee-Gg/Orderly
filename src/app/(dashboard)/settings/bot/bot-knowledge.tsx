"use client";

import { useState } from "react";
import { HelpCircle, Images, Info, Tag } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import type { BotKnowledge } from "@/lib/bot/knowledge-queries";
import { FaqsTab } from "./faqs-tab";
import { InfoTab } from "./info-tab";
import { MenuMediaTab } from "./menu-media-tab";
import { OffersTab } from "./offers-tab";

type TabValue = "menu" | "offers" | "faqs" | "info";
const TABS: TabValue[] = ["menu", "offers", "faqs", "info"];

export type BranchOption = { id: string; name: string };

export function BotKnowledgeTabs({
  data,
  restaurantId,
  branches,
  isRestaurantWide,
  canEditRestaurant,
  today,
  initialTab,
}: {
  initialTab?: string;
  data: BotKnowledge;
  restaurantId: string;
  branches: BranchOption[];
  isRestaurantWide: boolean;
  canEditRestaurant: boolean;
  today: string;
}) {
  const [tab, setTab] = useState<TabValue>(TABS.includes(initialTab as TabValue) ? (initialTab as TabValue) : "menu");

  function change(next: TabValue) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs<TabValue>
        aria-label="What the bot knows"
        variant="pill"
        value={tab}
        onValueChange={change}
        items={[
          { value: "menu", label: "Menu images", icon: <Images aria-hidden className="size-4" />, count: data.media.length },
          { value: "offers", label: "Offers", icon: <Tag aria-hidden className="size-4" />, count: data.offers.length },
          { value: "faqs", label: "Questions", icon: <HelpCircle aria-hidden className="size-4" />, count: data.faqs.length },
          { value: "info", label: "Restaurant info", icon: <Info aria-hidden className="size-4" /> },
        ]}
      />
      {tab === "menu" ? (
        <MenuMediaTab media={data.media} outdated={data.menuImageOutdated} restaurantId={restaurantId} branches={branches} isRestaurantWide={isRestaurantWide} />
      ) : tab === "offers" ? (
        <OffersTab
          offers={data.offers}
          items={data.items}
          branches={branches}
          isRestaurantWide={isRestaurantWide}
          today={today}
          timezone={data.restaurant.timezone}
          dealsCategoryId={data.dealsCategoryId}
        />
      ) : tab === "faqs" ? (
        <FaqsTab faqs={data.faqs} />
      ) : (
        <InfoTab branches={data.branches} restaurant={data.restaurant} canEditRestaurant={canEditRestaurant} />
      )}
    </div>
  );
}

/** "All branches" + the member's branches (branch-limited members only see theirs). */
export function branchOptions(branches: BranchOption[], isRestaurantWide: boolean) {
  return [...(isRestaurantWide ? [{ value: "", label: "All branches" }] : []), ...branches.map((b) => ({ value: b.id, label: b.name }))];
}
