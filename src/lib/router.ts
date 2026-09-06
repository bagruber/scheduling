import { useEffect, useState } from "react";

// Zwei Routen brauchen keine Router-Bibliothek.
const current = () => window.location.pathname + window.location.search;

export function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): string {
  const [href, setHref] = useState(current);
  useEffect(() => {
    const onPop = () => setHref(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return href;
}
