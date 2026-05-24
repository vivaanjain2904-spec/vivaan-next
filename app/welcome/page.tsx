import Landing from "@/components/Landing";

/**
 * Public landing preview at /welcome.
 * Unlike "/", this route doesn't redirect signed-in users away —
 * so anyone can view the marketing/landing page without signing out.
 */
export default function WelcomePage() {
  return <Landing />;
}
