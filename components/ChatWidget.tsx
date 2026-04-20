"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/lib/auth";
import { useChatContext, type ChatState } from "@/lib/ChatContext";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 11v4h4M15 7V3h-4M11 7l4-4M7 11l-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M11 3v4h4M7 15v-4H3M7 7L3 3M11 11l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M18 2L9 11M18 2l-6 16-3-7-7-3 16-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  content: "Hello! I'm MediBuddy, your medication assistant. I can answer questions about any of your medications — what they're for, how to take them, side effects to watch for, and more. What would you like to know?",
};

export default function ChatWidget() {
  const { chatState, setChatState }  = useChatContext();
  const [messages, setMessages]      = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput]            = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  const { session, loading } = useUser();

  const pathname = usePathname();

  // chatState must be read via ref here — adding it to the deps array would
  // cause the effect to fire when entering fullscreen and immediately undo it.
  const chatStateRef = useRef<ChatState>(chatState);
  chatStateRef.current = chatState;

  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (chatStateRef.current === "fullscreen") {
      setChatState("expanded");
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatState !== "collapsed") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatState]);

  useEffect(() => {
    if (chatState !== "collapsed" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [chatState]);

  if (loading || !session) return null;

  const isVisible    = chatState !== "collapsed";
  const isFullscreen = chatState === "fullscreen";
  const canSend      = !!input.trim() && !isStreaming;

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMessage: Message = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);

    const assistantPlaceholder: Message = { role: "assistant", content: "" };
    setMessages([...nextMessages, assistantPlaceholder]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.access_token}`,
        },
        body: JSON.stringify({
          // Strip the client-side greeting before sending — Claude didn't generate it.
          messages: nextMessages.filter((m) => !(m === messages[0] && m.role === "assistant")),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to get a response. Please try again.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: accumulated };
          return updated;
        });
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: errorText };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const headerButtons = (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <button
        onClick={() => setChatState(isFullscreen ? "expanded" : "fullscreen")}
        aria-label={isFullscreen ? "Minimize chat" : "Expand chat to fullscreen"}
        style={{
          background: "rgba(255,255,255,0.15)",
          border: "none",
          borderRadius: "50%",
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#FFFFFF",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.28)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
      >
        {isFullscreen ? <MinimizeIcon /> : <ExpandIcon />}
      </button>

      <button
        onClick={() => setChatState("collapsed")}
        aria-label="Close chat"
        style={{
          background: "rgba(255,255,255,0.15)",
          border: "none",
          borderRadius: "50%",
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#FFFFFF",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.28)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
      >
        <CloseIcon />
      </button>
    </div>
  );

  const messagesArea = (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: isFullscreen ? "32px 0" : "16px",
        display: "flex",
        flexDirection: "column",
        gap: isFullscreen ? "16px" : "12px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: isFullscreen ? "800px" : "none",
          margin: isFullscreen ? "0 auto" : "0",
          padding: isFullscreen ? "0 24px" : "0",
          display: "flex",
          flexDirection: "column",
          gap: isFullscreen ? "16px" : "12px",
        }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: isFullscreen ? "70%" : "80%",
                padding: isFullscreen ? "14px 18px" : "10px 14px",
                borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                backgroundColor: msg.role === "user" ? "#1E6FD9" : "#EDF2FA",
                color: msg.role === "user" ? "#FFFFFF" : "#1A202C",
                fontSize: isFullscreen ? "1.05rem" : "0.95rem",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
              }}
            >
              {msg.content}
              {msg.role === "assistant" && isStreaming && i === messages.length - 1 && (
                <span
                  style={{
                    display: "inline-block",
                    width: "2px",
                    height: "1em",
                    backgroundColor: "#1E6FD9",
                    marginLeft: "2px",
                    verticalAlign: "text-bottom",
                    animation: "dot-bounce 1s ease-in-out infinite",
                  }}
                />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );

  const inputArea = (
    <div
      style={{
        padding: isFullscreen ? "20px 24px 28px" : "12px 16px",
        borderTop: "1px solid #E2E8F0",
        display: "flex",
        gap: "10px",
        alignItems: "flex-end",
        flexShrink: 0,
        backgroundColor: isFullscreen ? "#F8FAFC" : "#FFFFFF",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: isFullscreen ? "800px" : "none",
          margin: isFullscreen ? "0 auto" : "0",
          display: "flex",
          gap: "10px",
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your medications…"
          disabled={isStreaming}
          rows={1}
          style={{
            flex: 1,
            padding: isFullscreen ? "14px 18px" : "10px 14px",
            border: "2px solid #E2E8F0",
            borderRadius: "14px",
            fontSize: isFullscreen ? "1.05rem" : "1rem",
            fontFamily: "var(--font-nunito)",
            color: "#1A202C",
            backgroundColor: "#FAFBFC",
            resize: "none",
            outline: "none",
            transition: "border-color 0.15s",
            lineHeight: 1.45,
            maxHeight: isFullscreen ? "140px" : "96px",
            overflowY: "auto",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#1E6FD9")}
          onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          style={{
            width: isFullscreen ? "48px" : "40px",
            height: isFullscreen ? "48px" : "40px",
            borderRadius: "50%",
            border: "none",
            backgroundColor: canSend ? "#1E6FD9" : "#CBD5E0",
            color: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: canSend ? "pointer" : "not-allowed",
            flexShrink: 0,
            transition: "background-color 0.15s",
          }}
          onMouseEnter={(e) => { if (canSend) e.currentTarget.style.backgroundColor = "#1558B0"; }}
          onMouseLeave={(e) => { if (canSend) e.currentTarget.style.backgroundColor = "#1E6FD9"; }}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {isFullscreen && (
        <div
          role="dialog"
          aria-label="MediBuddy chat — fullscreen"
          style={{
            position: "fixed",
            top: "64px",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
            backgroundColor: "#F8FAFC",
            display: "flex",
            flexDirection: "column",
            transition: "all 0.3s ease",
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #1E6FD9 0%, #1558B0 100%)",
              padding: "18px 28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  backgroundColor: "rgba(255,255,255,0.2)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFFFFF",
                }}
              >
                <ChatIcon />
              </div>
              <div>
                <p style={{ color: "#FFFFFF", fontWeight: 700, fontSize: "1.1rem", margin: 0, lineHeight: 1.2 }}>
                  MediBuddy
                </p>
                <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.875rem", margin: 0, lineHeight: 1.2 }}>
                  Your medication assistant
                </p>
              </div>
            </div>
            {headerButtons}
          </div>

          {messagesArea}
          {inputArea}
        </div>
      )}

      {/* Floating container stays mounted when fullscreen so the button reappears
          instantly on minimize rather than being reconstructed from scratch. */}
      <div
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "12px",
          visibility: isFullscreen ? "hidden" : "visible",
          pointerEvents: isFullscreen ? "none" : "auto",
        }}
      >
        {isVisible && (
          <div
            role="dialog"
            aria-label="MediBuddy chat assistant"
            style={{
              width: "400px",
              height: "500px",
              backgroundColor: "#FFFFFF",
              borderRadius: "16px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              border: "1px solid #E2E8F0",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transition: "all 0.3s ease",
            }}
            className="chat-window"
          >
            <div
              style={{
                background: "linear-gradient(135deg, #1E6FD9 0%, #1558B0 100%)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    backgroundColor: "rgba(255,255,255,0.2)",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#FFFFFF",
                  }}
                >
                  <ChatIcon />
                </div>
                <div>
                  <p style={{ color: "#FFFFFF", fontWeight: 700, fontSize: "1rem", margin: 0, lineHeight: 1.2 }}>
                    MediBuddy
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.8rem", margin: 0, lineHeight: 1.2 }}>
                    Your medication assistant
                  </p>
                </div>
              </div>
              {headerButtons}
            </div>

            {messagesArea}
            {inputArea}
          </div>
        )}

        <button
          onClick={() => setChatState(chatState === "collapsed" ? "expanded" : "collapsed")}
          aria-label={isVisible ? "Close medication chat" : "Ask about your medications"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: isVisible ? "0" : "14px 20px",
            width: isVisible ? "52px" : "auto",
            height: "52px",
            borderRadius: "26px",
            border: "none",
            backgroundColor: "#1E6FD9",
            color: "#FFFFFF",
            fontFamily: "var(--font-nunito)",
            fontSize: "1rem",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 16px rgba(30,111,217,0.4)",
            transition: "all 0.2s ease",
            justifyContent: "center",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1558B0")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#1E6FD9")}
        >
          <ChatIcon />
          {!isVisible && <span>Ask about your medications</span>}
        </button>
      </div>

      <style>{`
        @media (max-width: 480px) {
          .chat-window {
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 0 !important;
            bottom: auto !important;
            right: auto !important;
          }
        }
      `}</style>
    </>
  );
}
