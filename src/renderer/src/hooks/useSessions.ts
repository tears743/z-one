import { LogMessage } from "../types/message";

export const loadSessions = (
  setSessions: (sessions: any[]) => void,
  setCurrentSessionId: (id: string) => void,
  setMessages: (msgs: LogMessage[]) => void,
  createNewSession: () => void,
) => {
  const saved = localStorage.getItem("z-one-sessions");
  if (saved) {
    try {
      const loadedSessions = JSON.parse(saved);
      setSessions(loadedSessions);
      if (loadedSessions.length > 0) {
        // Load the first (most recent) session
        const mostRecent = loadedSessions[0];
        setCurrentSessionId(mostRecent.id);
        setMessages(mostRecent.messages);
      } else {
        createNewSession();
      }
    } catch (e) {
      console.error("Failed to parse sessions", e);
      createNewSession();
    }
  } else {
    createNewSession();
  }
};

export const saveCurrentSession = (
  currentSessionId: string,
  messages: LogMessage[],
  setSessions: (updater: (prev: any[]) => any[]) => void,
  trans: any,
) => {
  if (!currentSessionId || messages.length === 0) return;

  setSessions((prev) => {
    const index = prev.findIndex((s) => s.id === currentSessionId);
    const firstUserMsg = messages.find((m) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 30) +
        (firstUserMsg.content.length > 30 ? "..." : "")
      : trans.newChat;

    const updatedSession = {
      id: currentSessionId,
      title,
      timestamp: Date.now(),
      messages,
    };

    let nextSessions;
    if (index >= 0) {
      nextSessions = [...prev];
      nextSessions[index] = updatedSession;
    } else {
      nextSessions = [updatedSession, ...prev];
    }

    localStorage.setItem("z-one-sessions", JSON.stringify(nextSessions));
    return nextSessions;
  });
};
