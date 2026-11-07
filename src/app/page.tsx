import { redirect } from "next/navigation";

// Until auth exists, the app opens straight on the Orders board.
export default function Home() {
  redirect("/orders");
}
