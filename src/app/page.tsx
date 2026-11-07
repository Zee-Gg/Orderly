import { redirect } from "next/navigation";

// Every visit to "/" goes through the single post-login router.
export default function Home() {
  redirect("/auth/continue");
}
