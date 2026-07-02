import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { useAuth } from "../auth/useAuth";
import { apiFetch } from "../auth/api";
import { useAuthedBlobUrl } from "../hooks/useAuthedBlobURL";
import AnnotationCanvas from "./AnnotationCanvas";

const MAX_FILE_MB = 15;
const MAX_VOICE_SECONDS = 300;

/**
 * Inline chat + WebRTC video for one worker<->expert conversation.
 * Mounted inside ConsultExpert when a thread is selected from the sidebar.
 *
 * Workstream 3 additions on top of the original text-only thread:
 *   - file/photo/document sharing (FR-08)
 *   - voice messages (FR-10)
 *   - Konva.js image annotation (FR-09)
 */
export default function ConsultThread({ conversationId, counterpart }) {
  const convId = conversationId;
  const { user, token } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connecting");
  const [callStatus, setCallStatus] = useState("idle");
  const [counterpartOnline, setCounterpartOnline] = useState(false);
  const [remoteUserName, setRemoteUserName] = useState(null);
  const [callNotice, setCallNotice] = useState(null);
  const [threadError, setThreadError] = useState(null);
  const [showVideo, setShowVideo] = useState(false);
  const [needsPlayClick, setNeedsPlayClick] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [annotationTarget, setAnnotationTarget] = useState(null); // { fileId, downloadUrl, versions }
  const [annotationCounts, setAnnotationCounts] = useState({}); // fileId -> version count

  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const iceServersRef = useRef([]);
  const pendingCandidatesRef = useRef([]);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createPeerConnection = useCallback((servers) => {
    const pc = new RTCPeerConnection({ iceServers: servers });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current?.emit("call:ice-candidate", {
          conversationId: convId,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
        remoteVideoRef.current.play()
          .then(() => setNeedsPlayClick(false))
          .catch((err) => {
            if (err.name === "NotAllowedError") setNeedsPlayClick(true);
          });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setCallStatus("in-call");
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        setCallStatus("idle");
      }
    };

    pcRef.current = pc;
    return pc;
  }, [convId]);

  const getLocalStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play().catch(() => {});
    }
    return stream;
  }, []);

  const flushPendingCandidates = useCallback(async () => {
    for (const c of pendingCandidatesRef.current) {
      await pcRef.current?.addIceCandidate(new RTCIceCandidate(c));
    }
    pendingCandidatesRef.current = [];
  }, []);

  const endCallMedia = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setCallStatus("idle");
    setNeedsPlayClick(false);
  }, []);

  const handleOffer = useCallback(async (offer) => {
    setCallStatus("calling");
    setShowVideo(true);
    const stream = await getLocalStream();
    const pc = createPeerConnection(iceServersRef.current);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.emit("call:answer", { conversationId: convId, answer });
  }, [convId, getLocalStream, createPeerConnection, flushPendingCandidates]);

  const handleAnswer = useCallback(async (answer) => {
    await pcRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingCandidates();
  }, [flushPendingCandidates]);

  const handleRemoteCandidate = useCallback(async (candidate) => {
    if (!pcRef.current?.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);

  useEffect(() => {
    if (!token || !convId) return;

    let socket;
    let cancelled = false;

    const init = async () => {
      try {
        const turnRes = await apiFetch("/api/voip/turn-credentials");
        const servers = turnRes.ok ? await turnRes.json() : [];
        if (!cancelled) iceServersRef.current = servers;
      } catch {
        iceServersRef.current = [];
      }

      socket = io("/", { auth: { token }, path: "/socket.io" });

      socket.on("connect", () => {
        if (cancelled) return;
        setStatus("connected");
        socket.emit("chat:join", { conversationId: convId });
        socket.emit("call:join", { conversationId: convId });
      });

      socket.on("connect_error", (err) => {
        if (!cancelled) setStatus(`error: ${err.message}`);
      });

      socket.on("chat:history", ({ messages: history }) => {
        if (!cancelled) setMessages(history);
      });

      socket.on("chat:message", (msg) => {
        if (!cancelled) setMessages((prev) => [...prev, msg]);
      });

      socket.on("chat:file", (fileMsg) => {
        if (!cancelled) setMessages((prev) => [...prev, fileMsg]);
      });

      socket.on("chat:voice", (voiceMsg) => {
        if (!cancelled) setMessages((prev) => [...prev, voiceMsg]);
      });

      socket.on("chat:annotation", (annotation) => {
        if (cancelled) return;
        setAnnotationCounts((prev) => ({
          ...prev,
          [annotation.file_id]: Math.max(prev[annotation.file_id] || 0, annotation.version),
        }));
      });

      socket.on("chat:error", ({ message }) => {
        if (!cancelled) setThreadError(message);
      });

      socket.on("call:user-joined", ({ name, userId }) => {
        if (cancelled || userId === user?.id) return;
        setCounterpartOnline(true);
        setRemoteUserName(name);
        setCallNotice(null);
      });

      socket.on("call:offer", ({ offer }) => {
        handleOffer(offer).catch(() => setThreadError("Failed to accept incoming call."));
      });

      socket.on("call:answer", ({ answer }) => {
        handleAnswer(answer).catch(() => {});
      });

      socket.on("call:ice-candidate", ({ candidate }) => {
        handleRemoteCandidate(candidate).catch(() => {});
      });

      socket.on("call:user-left", ({ userId }) => {
        if (cancelled) return;
        endCallMedia();
        setShowVideo(false);
        if (!userId || userId !== user?.id) {
          setCounterpartOnline(false);
          setRemoteUserName(null);
        }
      });

      socket.on("call:error", ({ message }) => {
        if (cancelled) return;
        endCallMedia();
        setShowVideo(false);
        setCallNotice(message);
      });

      socket.on("disconnect", () => {
        if (!cancelled) setStatus("disconnected");
      });

      socketRef.current = socket;
    };

    init();

    return () => {
      cancelled = true;
      endCallMedia();
      socket?.emit("call:leave", { conversationId: convId });
      socket?.emit("chat:leave", { conversationId: convId });
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [token, convId, user?.id, handleOffer, handleAnswer, handleRemoteCandidate, endCallMedia]);

  function sendMessage() {
    if (!input.trim() || !socketRef.current) return;
    socketRef.current.emit("chat:send", {
      conversationId: convId,
      content: input.trim(),
    });
    setInput("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ---- Workstream 3: file upload ----

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setThreadError(`File is too large (max ${MAX_FILE_MB} MB).`);
      return;
    }

    setUploading(true);
    setThreadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/api/conversations/${convId}/files`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed.");
      }
    } catch (err) {
      setThreadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // ---- Workstream 3: voice messages ----

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recordTimerRef.current);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= MAX_VOICE_SECONDS) {
            stopRecording(true);
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setThreadError("Could not access microphone.");
    }
  }

  function stopRecording(autoStopped = false) {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recorder.addEventListener(
      "stop",
      async () => {
        setRecording(false);
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (autoStopped) setThreadError(`Voice message stopped automatically at ${MAX_VOICE_SECONDS}s.`);
        await uploadVoiceMessage(blob);
      },
      { once: true }
    );
    recorder.stop();
  }

  async function uploadVoiceMessage(blob) {
    setUploading(true);
    setThreadError(null);
    try {
      const form = new FormData();
      form.append("audio", blob, "voice-message");
      const res = await apiFetch(`/api/conversations/${convId}/voice`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not send voice message.");
      }
    } catch (err) {
      setThreadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // ---- Workstream 3: image annotation ----

  async function openAnnotator(fileMsg) {
    try {
      const res = await apiFetch(`/api/files/${fileMsg.id}/annotations`);
      const data = res.ok ? await res.json() : { annotations: [] };
      setAnnotationTarget({
        fileId: fileMsg.id,
        downloadUrl: `/api/conversations/${convId}/files/${fileMsg.id}`,
        versions: data.annotations || [],
      });
    } catch {
      setThreadError("Could not load existing annotations.");
    }
  }

  function handleAnnotationSaved(annotation) {
    setAnnotationCounts((prev) => ({ ...prev, [annotation.file_id]: annotation.version }));
    setAnnotationTarget(null);
  }

  async function startCall() {
    if (!counterpartOnline) {
      setCallNotice(`${counterpart?.name || "They"} must be logged in with this consultation open.`);
      return;
    }
    setCallNotice(null);
    setShowVideo(true);
    setCallStatus("calling");
    try {
      const stream = await getLocalStream();
      const pc = createPeerConnection(iceServersRef.current);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit("call:offer", { conversationId: convId, offer });
    } catch {
      setCallNotice("Could not access camera/microphone.");
      endCallMedia();
      setShowVideo(false);
    }
  }

  function hangUp() {
    endCallMedia();
    setShowVideo(false);
  }

  return (
    <div style={s.thread}>
      <div style={s.header}>
        <div>
          <h2 style={s.name}>{counterpart?.name}</h2>
          {counterpart?.bio && <p style={s.bio}>{counterpart.bio}</p>}
        </div>
        <div style={s.headerActions}>
          <span style={s.statusDot(counterpartOnline)} title={counterpartOnline ? "Online" : "Offline"} />
          <span style={s.statusText}>
            {counterpartOnline ? "Online" : "Offline"}
          </span>
          {!showVideo ? (
            <button
              style={{ ...s.callBtn, ...(!counterpartOnline ? s.callBtnDisabled : {}) }}
              onClick={startCall}
              disabled={status !== "connected" || !counterpartOnline}
              title={!counterpartOnline ? "Available when they open this consultation" : "Start video call"}
            >
              Video call
            </button>
          ) : (
            <button style={s.hangupBtn} onClick={hangUp}>
              {callStatus === "in-call" ? "End call" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      {callNotice && <div style={s.notice}>{callNotice}</div>}
      {threadError && <div style={s.error}>{threadError}</div>}

      {showVideo && (
        <div style={s.videoGrid}>
          <div style={s.videoBox}>
            <video ref={localVideoRef} style={s.video} autoPlay muted playsInline />
            <span style={s.videoLabel}>You</span>
          </div>
          <div style={s.videoBox}>
            <video ref={remoteVideoRef} style={s.video} autoPlay playsInline />
            <span style={s.videoLabel}>{remoteUserName || counterpart?.name || "Waiting…"}</span>
            {needsPlayClick && (
              <button
                style={s.playBtn}
                onClick={() => remoteVideoRef.current?.play().then(() => setNeedsPlayClick(false))}
              >
                Click to play video
              </button>
            )}
          </div>
        </div>
      )}

      <div style={s.chatBox}>
        {messages.length === 0 && (
          <p style={s.emptyChat}>No messages yet — say hello to start.</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === user?.id;
          const key = `${msg.type}-${msg.id ?? msg.ts}`;
          return (
            <div key={key} style={s.bubbleRow(isMe)}>
              {msg.type === "file" ? (
                <FileBubble
                  msg={msg}
                  isMe={isMe}
                  convId={convId}
                  annotationVersion={annotationCounts[msg.id]}
                  onAnnotate={() => openAnnotator(msg)}
                />
              ) : msg.type === "voice" ? (
                <VoiceBubble msg={msg} isMe={isMe} convId={convId} />
              ) : (
                <div style={s.bubble(isMe)}>
                  {!isMe && <div style={s.senderName}>{msg.sender_name}</div>}
                  <div>{msg.content}</div>
                  <div style={s.timestamp}>
                    {new Date(msg.sent_at || msg.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />
        <button
          style={s.iconBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={status !== "connected" || uploading}
          title="Attach a photo or document"
        >
          📎
        </button>
        <button
          style={{ ...s.iconBtn, ...(recording ? s.iconBtnActive : {}) }}
          onClick={() => (recording ? stopRecording() : startRecording())}
          disabled={status !== "connected" || uploading}
          title={recording ? "Stop recording" : "Record a voice message"}
        >
          {recording ? `⏹ ${recordSeconds}s` : "🎙️"}
        </button>
        <input
          style={s.input}
          placeholder={status === "connected" ? "Message…" : "Connecting…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={status !== "connected"}
        />
        <button style={s.sendBtn} onClick={sendMessage} disabled={status !== "connected" || !input.trim()}>
          Send
        </button>
      </div>

      {annotationTarget && (
        <AnnotationCanvas
          fileId={annotationTarget.fileId}
          downloadUrl={annotationTarget.downloadUrl}
          existingVersions={annotationTarget.versions}
          onSaved={handleAnnotationSaved}
          onClose={() => setAnnotationTarget(null)}
        />
      )}
    </div>
  );
}

/** Image/document bubble — shows a thumbnail for images, a download link otherwise. */
function FileBubble({ msg, isMe, convId, annotationVersion, onAnnotate }) {
  const downloadUrl = `/api/conversations/${convId}/files/${msg.id}`;
  const isImage = (msg.mime_type || "").startsWith("image/");
  const { objectUrl } = useAuthedBlobUrl(isImage ? downloadUrl : null);

  async function download() {
    const res = await apiFetch(downloadUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = msg.original_filename || "file";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={s.bubble(isMe)}>
      {!isMe && <div style={s.senderName}>{msg.sender_name || msg.uploader_name}</div>}
      {isImage ? (
        <>
          {objectUrl ? (
            <img src={objectUrl} alt={msg.original_filename} style={s.thumb} onClick={download} />
          ) : (
            <div style={s.thumbLoading}>Loading image…</div>
          )}
          <div style={s.fileRow}>
            <span style={s.fileName}>{msg.original_filename}</span>
            <button style={s.linkBtn} onClick={onAnnotate}>
              {annotationVersion ? `Annotations (${annotationVersion})` : "Annotate"}
            </button>
          </div>
        </>
      ) : (
        <button style={s.docRow} onClick={download}>
          📄 {msg.original_filename}
        </button>
      )}
      <div style={s.timestamp}>
        {new Date(msg.sent_at || msg.uploaded_at || msg.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

/** Voice message bubble — authenticated audio playback. */
function VoiceBubble({ msg, isMe, convId }) {
  const downloadUrl = `/api/conversations/${convId}/voice/${msg.id}`;
  const { objectUrl } = useAuthedBlobUrl(downloadUrl);

  return (
    <div style={s.bubble(isMe)}>
      {!isMe && <div style={s.senderName}>{msg.sender_name}</div>}
      {objectUrl ? (
        <audio controls src={objectUrl} style={{ width: 220 }} />
      ) : (
        <div style={s.thumbLoading}>Loading voice message…</div>
      )}
      <div style={s.timestamp}>
        {msg.duration_seconds ? `${msg.duration_seconds}s · ` : ""}
        {new Date(msg.sent_at || msg.uploaded_at || msg.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

const s = {
  thread: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--orca-line)", flexShrink: 0,
  },
  name: { fontSize: 18, fontWeight: 600, margin: "0 0 4px", color: "var(--orca-paper)" },
  bio: { fontSize: 12, color: "var(--orca-muted)", margin: 0, lineHeight: 1.4, maxWidth: 360 },
  headerActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  statusDot: (ok) => ({ width: 8, height: 8, borderRadius: "50%", background: ok ? "var(--orca-signal)" : "var(--orca-faint)" }),
  statusText: { fontSize: 12, color: "var(--orca-muted)" },
  callBtn: { padding: "7px 12px", borderRadius: 8, border: "none", background: "#22c55e", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  callBtnDisabled: { background: "var(--orca-faint)", cursor: "not-allowed" },
  hangupBtn: { padding: "7px 12px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  notice: { margin: "0 20px", padding: "10px 12px", borderRadius: 8, background: "#1e293b", color: "var(--orca-muted)", fontSize: 13, border: "1px solid var(--orca-line)" },
  error: { margin: "0 20px", padding: "10px 12px", borderRadius: 8, background: "#450a0a", color: "#fca5a5", fontSize: 13 },
  videoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 20px 0", flexShrink: 0 },
  videoBox: { background: "#111", borderRadius: 10, overflow: "hidden", aspectRatio: "16/10", position: "relative" },
  video: { width: "100%", height: "100%", objectFit: "cover" },
  videoLabel: { position: "absolute", bottom: 6, left: 6, color: "#fff", fontSize: 10, background: "rgba(0,0,0,0.55)", padding: "2px 6px", borderRadius: 4 },
  playBtn: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", padding: "8px 12px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 12, cursor: "pointer" },
  chatBox: { flex: 1, overflowY: "auto", padding: 16, margin: "12px 20px", border: "1px solid var(--orca-line)", borderRadius: 10, background: "var(--orca-abyss)", minHeight: 0 },
  emptyChat: { textAlign: "center", color: "var(--orca-faint)", fontSize: 14, marginTop: 40 },
  bubbleRow: (isMe) => ({ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", marginBottom: 8 }),
  bubble: (isMe) => ({
    maxWidth: "75%", padding: "8px 12px", borderRadius: 12,
    background: isMe ? "var(--orca-hi)" : "var(--orca-slate)",
    color: isMe ? "#fff" : "var(--orca-ink)",
    border: isMe ? "none" : "1px solid var(--orca-line)",
    fontSize: 14,
  }),
  senderName: { fontSize: 11, color: "var(--orca-muted)", marginBottom: 2 },
  timestamp: { fontSize: 10, color: "var(--orca-faint)", marginTop: 4, textAlign: "right" },
  inputRow: { display: "flex", gap: 8, padding: "12px 20px 16px", flexShrink: 0, alignItems: "center" },
  iconBtn: { padding: "9px 10px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", fontSize: 14, cursor: "pointer", lineHeight: 1 },
  iconBtnActive: { background: "#ef4444", color: "#fff", borderColor: "#ef4444" },
  input: { flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", fontSize: 14 },
  sendBtn: { padding: "10px 18px", borderRadius: 8, border: "none", background: "var(--orca-hi)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  thumb: { display: "block", maxWidth: 220, maxHeight: 220, borderRadius: 8, cursor: "pointer", objectFit: "cover" },
  thumbLoading: { width: 220, height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--orca-faint)", fontSize: 12, background: "rgba(255,255,255,0.05)", borderRadius: 8 },
  fileRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 },
  fileName: { fontSize: 12, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 },
  linkBtn: { background: "none", border: "none", color: "inherit", textDecoration: "underline", fontSize: 11, cursor: "pointer", padding: 0 },
  docRow: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "inherit", fontSize: 13, cursor: "pointer", padding: 0, textDecoration: "underline" },
};