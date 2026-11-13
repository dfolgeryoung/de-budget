import { useEffect, useState } from "react";
import { Shell } from "./ui/Shell";
import { SignIn } from "./ui/SignIn";

interface Me { id: string; email: string; name: string }

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    const load = () => fetch("/api/me").then(async (r) => setMe(r.ok ? ((await r.json()) as Me) : null)).catch(() => setMe(null));
    load();
    addEventListener("me-changed", load);
    return () => removeEventListener("me-changed", load);
  }, []);
  if (me === undefined) return null; // first paint: nothing, to avoid a flash of the sign-in page
  if (me === null) return <SignIn />;
  return <Shell me={me} />;
}
