import { describe, expect, it } from "vitest";
import { localDate, localDateRange, timeAgo, todayRange } from "./time";

describe("today in Asia/Karachi (UTC+5)", () => {
  it("1:30 AM in Lahore is still 'today' locally even though UTC is the day before", () => {
    const now = new Date("2026-11-07T20:30:00Z"); // 01:30 on 8 Nov in Karachi
    expect(localDate(now)).toBe("2026-11-08");
    const { start, end } = todayRange("Asia/Karachi", now);
    expect(start.toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-08T19:00:00.000Z");
  });

  it("11 PM in Lahore belongs to that day", () => {
    const now = new Date("2026-11-08T18:00:00Z"); // 23:00 on 8 Nov
    expect(todayRange("Asia/Karachi", now).start.toISOString()).toBe("2026-11-07T19:00:00.000Z");
  });

  it("builds inclusive date ranges", () => {
    const { start, end } = localDateRange("2026-11-01", "2026-11-07");
    expect(start.toISOString()).toBe("2026-10-31T19:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-07T19:00:00.000Z");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-08T12:00:00Z").getTime();
  it("reads naturally", () => {
    expect(timeAgo("2026-11-08T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-08T11:54:00Z", now)).toBe("6 min ago");
    expect(timeAgo("2026-11-08T09:00:00Z", now)).toBe("3 hr ago");
  });
});
