import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";

export default async function RootIndex() {
  const s = await readSession();
  redirect(s ? "/overview" : "/login");
}
