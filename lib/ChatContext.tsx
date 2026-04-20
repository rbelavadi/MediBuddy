"use client";

import { createContext, useContext, useState } from "react";

export type ChatState = "collapsed" | "expanded" | "fullscreen";

interface ChatContextValue {
  chatState: ChatState;
  setChatState: (state: ChatState) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [chatState, setChatState] = useState<ChatState>("collapsed");

  return (
    <ChatContext.Provider value={{ chatState, setChatState }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used inside <ChatProvider>");
  return ctx;
}
