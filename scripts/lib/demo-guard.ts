/**
 * ONE shared Supabase project for development AND production (Phase 12).
 * Every script that writes demo or fake data must call this first: it
 * refuses unless ALLOW_DEMO_DATA=true, and always prints a loud warning.
 *
 *   ALLOW_DEMO_DATA=true in .env.local only while testing BEFORE launch.
 *   Keep it false (or unset) after launch.
 */
export function requireDemoDataAllowed(scriptName: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(no NEXT_PUBLIC_SUPABASE_URL)";
  if (process.env.ALLOW_DEMO_DATA !== "true") {
    console.error(
      [
        "",
        `✋ ${scriptName} is switched off.`,
        "   It writes demo/fake data, and this app uses ONE Supabase project for development and production.",
        "   To run it while testing before launch, set ALLOW_DEMO_DATA=true in .env.local.",
        "   Never run it after launch.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.warn(
    [
      "",
      "⚠️  WARNING: this script WRITES TO THE LIVE DATABASE:",
      `   ${url}`,
      "   (ALLOW_DEMO_DATA=true). Real restaurants share this database — be careful.",
      "",
    ].join("\n"),
  );
}
