import { startMockGraph } from "./mock-graph";

/** Starts the fake WhatsApp Graph API for the whole run; the returned function stops it. */
export default async function globalSetup() {
  const server = await startMockGraph();
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
