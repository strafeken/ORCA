/** Registers all socket.io handlers for a ConsultThread instance. */
export function registerConsultThreadSocketHandlers(socket, h) {
  const { convId, userId, isCancelled } = h;

  socket.on("connect", () => {
    if (isCancelled()) return;
    h.setStatus("connected");
    socket.emit("chat:join", { conversationId: convId });
    socket.emit("call:join", { conversationId: convId });
  });

  socket.on("connect_error", (err) => {
    if (isCancelled()) return;
    h.setStatus(`error: ${err.message}`);
  });

  socket.on("chat:history", ({ messages: history }) => {
    if (isCancelled()) return;
    h.setMessages(history);
  });

  socket.on("chat:message", (msg) => {
    if (isCancelled()) return;
    h.appendMessage(msg);
  });

  socket.on("chat:file", (fileMsg) => {
    if (isCancelled()) return;
    h.appendMessage(fileMsg);
  });

  socket.on("chat:voice", (voiceMsg) => {
    if (isCancelled()) return;
    h.appendMessage(voiceMsg);
  });

  socket.on("chat:annotation", (annotation) => {
    if (isCancelled()) return;
    h.onAnnotation(annotation);
  });

  socket.on("chat:error", ({ message }) => {
    if (isCancelled()) return;
    h.setThreadError(message);
  });

  socket.on("call:user-joined", ({ name, userId: joinedUserId }) => {
    if (isCancelled() || joinedUserId === userId) return;
    h.setCounterpartOnline(true);
    h.setRemoteUserName(name);
    h.setCallNotice(null);
  });

  socket.on("call:ring", ({ name }) => {
    if (isCancelled()) return;
    if (h.getCallStatus() === "idle") {
      h.onIncomingRing(name);
    } else {
      socket.emit("call:decline", { conversationId: convId });
    }
  });

  socket.on("call:accept", () => {
    if (isCancelled() || h.getCallRole() !== "caller") return;
    h.onCallerAccepted();
  });

  socket.on("call:decline", () => {
    if (isCancelled() || h.getCallRole() !== "caller") return;
    h.onCallerDeclined();
  });

  socket.on("call:cancel", () => {
    if (isCancelled() || h.getCallStatus() !== "incoming") return;
    h.onCallerCancelled();
  });

  socket.on("call:offer", ({ offer }) => {
    if (isCancelled() || h.getCallRole() !== "callee" || !h.isAccepted()) return;
    h.onRemoteOffer(offer);
  });

  socket.on("call:answer", ({ answer }) => {
    h.onRemoteAnswer(answer);
  });

  socket.on("call:ice-candidate", ({ candidate }) => {
    h.onRemoteCandidate(candidate);
  });

  socket.on("call:annotation", ({ stroke }) => {
    if (isCancelled() || !Array.isArray(stroke?.points)) return;
    h.onRemoteAnnotation(stroke);
  });

  socket.on("call:annotation-clear", () => {
    if (isCancelled()) return;
    h.onRemoteAnnotationClear();
  });

  socket.on("call:ended", () => {
    if (isCancelled()) return;
    h.onCallEnded("Call ended — text chat remains available.");
  });

  socket.on("call:user-left", ({ userId: leftUserId }) => {
    if (isCancelled()) return;
    h.onUserLeft(leftUserId);
  });

  socket.on("call:error", ({ message }) => {
    if (isCancelled()) return;
    h.onCallError(message);
  });

  socket.on("disconnect", () => {
    if (isCancelled()) return;
    h.setStatus("disconnected");
  });
}

export function handlePeerConnectionStateChange(pc, activePc, callbacks) {
  if (pc.connectionState === "connected") {
    callbacks.onConnected();
    return;
  }
  if (pc.connectionState === "disconnected") {
    callbacks.onUnstable();
    return;
  }
  if (["failed", "closed"].includes(pc.connectionState) && activePc === pc) {
    callbacks.onEnded();
  }
}

export function normPoint(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
    y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
  };
}

export const ACTIVE_CALL_STATES = new Set(["ringing", "connecting", "in-call"]);

export function isActiveCallState(status) {
  return ACTIVE_CALL_STATES.has(status);
}

export function CallHeaderAction({
  callStatus,
  counterpartOnline,
  status,
  onStartCall,
  onCancelCall,
  onHangUp,
  styles,
}) {
  if (callStatus === "idle") {
    return (
      <button
        className="orca-call-btn"
        style={{ ...styles.callBtn, ...(counterpartOnline ? {} : styles.callBtnDisabled) }}
        onClick={onStartCall}
        disabled={status !== "connected" || !counterpartOnline}
        title={counterpartOnline ? "Start video call" : "Available when they open this consultation"}
      >
        Video call
      </button>
    );
  }
  if (callStatus === "incoming") return null;
  if (callStatus === "ringing") {
    return (
      <button className="orca-hangup-btn" style={styles.hangupBtn} onClick={onCancelCall}>
        Cancel
      </button>
    );
  }
  const label = callStatus === "in-call" ? "End call" : "Cancel";
  return (
    <button className="orca-hangup-btn" style={styles.hangupBtn} onClick={onHangUp}>
      {label}
    </button>
  );
}
