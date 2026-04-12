import AppShell from "./components/layout/AppShell";
import WelcomeScreen from "./components/scenario/WelcomeScreen";
import ResultsDashboard from "./components/scenario/ResultsDashboard";
import ChatPanel from "./components/chat/ChatPanel";
import { useAppStore } from "./stores/appStore";
import { useScenarioStore } from "./stores/scenarioStore";

function App() {
  const { activeView, lakes, selectedLakeId } = useAppStore();
  const result = useScenarioStore((s) => s.result);
  const selectedLake = lakes.find((l) => l.id === selectedLakeId);

  return (
    <AppShell>
      {activeView === "dashboard" && !result && <WelcomeScreen />}
      {activeView === "dashboard" && result && selectedLake && (
        <ResultsDashboard result={result} lake={selectedLake} />
      )}
      {activeView === "chat" && <ChatPanel />}
    </AppShell>
  );
}

export default App;
