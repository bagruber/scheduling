import NewPoll from "./pages/NewPoll.tsx";
import PollPage from "./pages/PollPage.tsx";
import { useRoute } from "./lib/router.ts";
import { DEMO, DEMO_ID } from "./lib/demoStore.ts";

export default function App() {
  const href = useRoute();
  // Das Mockup hat genau einen Termin und keinen Server, der andere Pfade
  // ausliefern koennte — deshalb zeigt es diesen einen, egal welcher Pfad.
  if (DEMO) return <PollPage id={DEMO_ID} />;
  const match = /^\/e\/([a-z0-9]+)/.exec(href);
  return match ? <PollPage id={match[1]} /> : <NewPoll />;
}
