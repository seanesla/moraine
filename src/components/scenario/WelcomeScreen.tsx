import { ArrowLeft } from "lucide-react";

export default function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-2 text-text-muted text-sm">
        <ArrowLeft className="w-4 h-4" />
        <span>Select a lake and run a scenario to see results</span>
      </div>
    </div>
  );
}
