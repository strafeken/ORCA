import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const CONVERSATION_ID = 1;

export default function Chat() {
  const [userId, setUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("disconnected");
  const [currentUser, setCurrentUser] = useState(null);
  const socketRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Socket lifecycle tied to userId
  useEffect(() => {
    if (!userId) return;

    let socket;

    const initSocket = async () => {
      // Get fake token
      const res = await axios.get(`/api/auth/fake-login?userId=${userId}`);
      const { token } = res.data;

      socket = io("/", {
        auth: { token },
        path: "/socket.io",
      });

      socket.on("connect", () => {
        setStatus("connected");
        socket.emit("chat:join", { conversationId: CONVERSATION_ID });
      });

      socket.on("connect_error", (err) => {
        setStatus(`error: ${err.message}`);
      });

      socket.on("chat:history", ({ messages: history }) => {
        setMessages(history);
      });

      socket.on("chat:message", (msg) => {
        setMessages(prev => [...prev, msg]);
      });

      socket.on("chat:error", ({ message }) => {
        alert(`Socket error: ${message}`);
      });

      socket.on("disconnect", () => setStatus("disconnected"));

      socketRef.current = socket;
    };

    initSocket();

    // Cleanup — runs on unmount or when userId changes
    return () => {
      socket?.disconnect();
      socketRef.current = null;
      setStatus("disconnected");
      setMessages([]);
      setCurrentUser(null);
    };
  }, [userId]);

  const selectUser = (uid) => {
    if (userId === uid) {
      // Clicking the same user disconnects
      setUserId(null);
    } else {
      setCurrentUser(uid === "user-1"
        ? { id: 1, name: "John Doe" }
        : { id: 3, name: "Bob Chen" }
      );
      setUserId(uid);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || !socketRef.current) return;
    socketRef.current.emit("chat:send", {
      conversationId: CONVERSATION_ID,
      content: input.trim(),
    });
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const s = {
    page: { padding: "2rem", fontFamily: "sans-serif", maxWidth: 700, margin: "0 auto" },
    title: { fontSize: 20, fontWeight: 500, marginBottom: 4 },
    subtitle: { fontSize: 13, color: "#888", marginBottom: "1.5rem" },
    userSelect: { display: "flex", gap: 8, marginBottom: "1.5rem" },
    userBtn: (active) => ({
      padding: "8px 16px", borderRadius: 8, border: "0.5px solid #ddd",
      cursor: "pointer", fontSize: 13,
      background: active ? "#222" : "white",
      color: active ? "white" : "#222",
    }),
    statusBar: { fontSize: 12, color: "#888", marginBottom: "1rem" },
    dot: (connected) => ({
      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
      background: connected ? "#22c55e" : "#e5e7eb",
      marginRight: 6,
    }),
    chatBox: {
      border: "0.5px solid #e0e0e0", borderRadius: 12,
      height: 420, overflowY: "auto", padding: "1rem",
      marginBottom: "1rem", background: "#fafafa",
    },
    messageBubble: (isMe) => ({
      display: "flex", justifyContent: isMe ? "flex-end" : "flex-start",
      marginBottom: 8,
    }),
    bubble: (isMe) => ({
      maxWidth: "70%", padding: "8px 12px", borderRadius: 12,
      background: isMe ? "#222" : "white",
      color: isMe ? "white" : "#222",
      border: isMe ? "none" : "0.5px solid #e0e0e0",
      fontSize: 13,
    }),
    senderName: { fontSize: 11, color: "#888", marginBottom: 2 },
    timestamp: { fontSize: 10, color: "#aaa", marginTop: 2, textAlign: "right" },
    inputRow: { display: "flex", gap: 8 },
    input: {
      flex: 1, padding: "8px 12px", borderRadius: 8,
      border: "0.5px solid #ddd", fontSize: 13,
    },
    sendBtn: {
      padding: "8px 16px", borderRadius: 8, border: "none",
      background: "#222", color: "white", cursor: "pointer", fontSize: 13,
    },
  };

  return (
    <div style={s.page}>
      <h1 style={s.title}>Chat test</h1>
      <p style={s.subtitle}>Connect as a user to test real-time messaging</p>

      <div style={s.userSelect}>
        {["user-1", "user-2"].map(uid => (
          <button
            key={uid}
            style={s.userBtn(userId === uid)}
            onClick={() => selectUser(uid)}
          >
            {uid === "user-1" ? "John Doe (Worker)" : "Bob Chen (Expert)"}
            {userId === uid ? " ✕" : ""}
          </button>
        ))}
      </div>

      <div style={s.statusBar}>
        <span style={s.dot(status === "connected")} />
        {status === "connected" ? `Connected as ${currentUser?.name}` : status}
      </div>

      <div style={s.chatBox}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, marginTop: "2rem" }}>
            No messages yet
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.sender_id === currentUser?.id;
          return (
            <div key={i} style={s.messageBubble(isMe)}>
              <div style={s.bubble(isMe)}>
                {!isMe && <div style={s.senderName}>{msg.sender_name}</div>}
                <div>{msg.content}</div>
                <div style={s.timestamp}>
                  {new Date(msg.sent_at).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          style={s.input}
          placeholder={status === "connected" ? "Type a message... (Enter to send)" : "Connect first"}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={status !== "connected"}
        />
        <button style={s.sendBtn} onClick={sendMessage} disabled={status !== "connected"}>
          Send
        </button>
      </div>
    </div>
  );
}