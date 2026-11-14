import { useEffect, useState } from "react";
import { Shell } from "./ui/Shell";
import { SignIn } from "./ui/SignIn";
import { setCacheUser, clearCache } from "./ui/api";

interface Me { id: string; email: string; name: string }

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(() => {
    // the last signed-in person, so the shell paints before the server answers; /me still decides
    try { const raw = localStorage.getItem("cache:me"); if (raw) { const m = JSON.parse(raw) as Me; setCacheUser(m.id); return m; } } catch { /* storage off */ }
    return undefined;
  });
  useEffect(() => {
    const load = () => fetch("/api/me").then(async (r) => {
      if (r.ok) { const m = (await r.json()) as Me; setCacheUser(m.id); try { localStorage.setItem("cache:me", JSON.stringify(m)); } catch { /* storage off */ } setMe(m); }
      else { clearCache(); try { localStorage.removeItem("cache:me"); } catch { /* storage off */ } setMe(null); }
    }).catch(() => setMe((m) => m ?? null));
    load();
    addEventListener("me-changed", load);
    return () => removeEventListener("me-changed", load);
  }, []);
  if (me === undefined) return null; // first paint: nothing, to avoid a flash of the sign-in page
  if (me === null) return <SignIn />;
  return <Shell me={me} />;
}
