import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import Header from "@/components/Header";
import Nav from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await readSession();
  if (!s) redirect("/login");
  return (
    <div className="max-w-[1440px] mx-auto px-5 sm:px-8 pt-6 pb-32 md:pb-8">
      <Header />
      <Nav />
      {children}
    </div>
  );
}
