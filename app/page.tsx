import { readSession } from "@/lib/auth";
import Landing from "@/components/Landing";

// Everyone — logged in or not — sees the landing page first.
// Logged-in users get a "Go to Dashboard" button in the nav instead of Sign in.
export default async function RootIndex() {
  const s = await readSession();
  return <Landing loggedIn={!!s} />;
}
