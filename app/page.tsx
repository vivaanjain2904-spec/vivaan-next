import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import Landing from "@/components/Landing";

export default async function RootIndex() {
  const s = await readSession();
  if (s) redirect("/overview");
  return <Landing />;
}
