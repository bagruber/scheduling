import NewPoll from "./pages/NewPoll.tsx";
import PollPage from "./pages/PollPage.tsx";
import { useRoute } from "./lib/router.ts";

export default function App() {
  const href = useRoute();
  const match = /^\/e\/([a-z0-9]+)/.exec(href);
  return match ? <PollPage id={match[1]} /> : <NewPoll />;
}
