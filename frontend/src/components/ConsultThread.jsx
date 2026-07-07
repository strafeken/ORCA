import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { useAuth } from "../auth/useAuth";
import { apiFetch } from "../auth/api";
import { useAuthedBlobUrl } from "../hooks/useAuthedBlobURL";
import AnnotationCanvas from "./AnnotationCanvas";
import { useCallGuard } from "./callGuard";

const MAX_FILE_MB = 15;
const MAX_VOICE_SECONDS = 300;

/**
 * Inline chat + WebRTC video for one worker<->expert conversation.
 * Mounted inside ConsultExpert when a thread is selected from the sidebar.
 *
 * Workstream 3 additions on top of the original text-only thread:
 *   - file/photo/document sharing (FR-08)
 *   - voice messages (FR-10)
 *   - Konva.js image annotation on shared files (FR-09)
 *
 * WebRTC video call (FR-11): during a call either side can draw on the OTHER
 * person's video to point things out; strokes travel over the same
 * authenticated signalling socket with normalized [0,1] coordinates and are
 * never persisted (SR-04). Chat and call share the socket but not their fate:
 * if the peer connection drops or the TURN fetch fails, the call tears down
 * cleanly and messaging keeps working (SR-15).
 */

// Stroke colors per role so both sides can tell who drew what.
const STROKE_COLORS = { worker: "#22d3ee", expert: "#f59e0b" };
const MAX_STROKE_POINTS = 512;
const RING_TIMEOUT_MS = 30000; // auto-cancel an unanswered outgoing call

// Call lifecycle states where media is (or is about to be) active — used to
// warn before the user leaves and to gate the leave guard.
const ACTIVE_CALL_STATES = ["ringing", "connecting", "in-call"];

export default function ConsultThread({ conversationId, counterpart, onCallActiveChange, onBack }) {
  const convId = conversationId;
  const { user, token } = useAuth();
  const { setCallActive } = useCallGuard();

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
  const [canFlip, setCanFlip] = useState(false);   // device has >1 camera (mobile)
  const [flipping, setFlipping] = useState(false);  // swap in progress

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
  // Workstream 3: file upload + voice recording
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  // FR-11 live call annotation + camera flip
  const remoteCanvasRef = useRef(null); // overlay I draw on (their video)
  const localCanvasRef = useRef(null);  // overlay showing their drawings on my feed
  const myStrokesRef = useRef([]);
  const peerStrokesRef = useRef([]);
  const drawingRef = useRef(null); // in-progress stroke
  const facingModeRef = useRef("user"); // "user" = front, "environment" = back
  const flippingRef = useRef(false);    // re-entrancy guard for flipCamera
  // FR-11 call setup handshake (ring → accept/decline)
  const callRoleRef = useRef(null);     // "caller" | "callee" | null
  const acceptedRef = useRef(false);    // callee accepted the incoming call
  const ringTimeoutRef = useRef(null);  // outgoing-call no-answer timer
  const callStatusRef = useRef("idle"); // mirror of callStatus for socket handlers
  const peerNameRef = useRef(counterpart?.name || null); // for call-setup messages

  const myColor = STROKE_COLORS[user?.role] || STROKE_COLORS.worker;

  // Keep ref copies of state the socket handlers read, so the handlers (set up
  // once) don't have to be re-bound — and the socket reconnected — on every
  // render.
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    peerNameRef.current = remoteUserName || counterpart?.name || null;
  }, [remoteUserName, counterpart]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Live annotation overlay (FR-11) ──────────────────────────────
  // I annotate the remote video (the feed I'm looking at); the peer renders
  // my strokes over their local preview, which shows that same feed. The
  // normalized coordinates make the strokes independent of tile size.
  const redrawLayer = useCallback((canvas, strokes, liveStroke) => {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const all = liveStroke ? [...strokes, liveStroke] : strokes;
    for (const stroke of all) {
      if (!stroke?.points || stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x * w, p.y * h);
        else ctx.lineTo(p.x * w, p.y * h);
      });
      ctx.stroke();
    }
  }, []);

  const redrawAnnotations = useCallback(() => {
    redrawLayer(remoteCanvasRef.current, myStrokesRef.current, drawingRef.current);
    redrawLayer(localCanvasRef.current, peerStrokesRef.current, null);
  }, [redrawLayer]);

  const resetAnnotations = useCallback(() => {
    myStrokesRef.current = [];
    peerStrokesRef.current = [];
    drawingRef.current = null;
    redrawAnnotations();
  }, [redrawAnnotations]);

  // Clear only MY strokes (the ones I drew on the peer's video). The peer is
  // told to drop them from their view via call:annotation-clear, but their own
  // drawings — and mine of theirs — are left untouched (#2).
  const clearMyStrokes = useCallback(() => {
    myStrokesRef.current = [];
    drawingRef.current = null;
    redrawAnnotations();
  }, [redrawAnnotations]);

  // Clear only the PEER's strokes (what they drew on my video), e.g. when they
  // clear their own drawings.
  const clearPeerStrokes = useCallback(() => {
    peerStrokesRef.current = [];
    redrawAnnotations();
  }, [redrawAnnotations]);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const getLocalStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      // `ideal` (not `exact`) so desktops with a single, non-facing camera
      // still succeed instead of throwing OverconstrainedError.
      video: { facingMode: { ideal: facingModeRef.current } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play().catch(() => {});
    }
    // Only offer the flip control when the device actually has more than one
    // camera (i.e. a phone). Device labels/ids are only populated after the
    // getUserMedia grant above, so enumerate here rather than earlier.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
    } catch {
      setCanFlip(false);
    }
    return stream;
  }, []);

  // Switch between front and back cameras mid-call (mobile). Uses
  // RTCRtpSender.replaceTrack so the outgoing video is swapped WITHOUT
  // renegotiation — the peer connection, the audio track, and the live
  // annotation overlay (keyed to normalized coordinates) all keep working.
  const flipCamera = useCallback(async () => {
    const currentStream = localStreamRef.current;
    if (flippingRef.current || !currentStream) return;
    flippingRef.current = true;
    setFlipping(true);
    const nextMode = facingModeRef.current === "user" ? "environment" : "user";
    try {
      // Acquire ONLY a new video track; leave the existing audio track live so
      // audio never drops during the swap.
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextMode } },
      });
      const newVideoTrack = camStream.getVideoTracks()[0];
      if (!newVideoTrack) throw new Error("no video track");

      const sender = pcRef.current
        ?.getSenders()
        .find((sn) => sn.track && sn.track.kind === "video");
      if (sender) await sender.replaceTrack(newVideoTrack);

      // Update the local preview stream in place: drop+stop the old video
      // track, splice in the new one, leave audio untouched.
      const oldVideoTrack = currentStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        currentStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      currentStream.addTrack(newVideoTrack);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = currentStream;
        await localVideoRef.current.play().catch(() => {});
      }
      facingModeRef.current = nextMode;
      redrawAnnotations(); // aspect ratio may change; keep strokes aligned
    } catch {
      setCallNotice("Couldn't switch camera.");
    } finally {
      flippingRef.current = false;
      setFlipping(false);
    }
  }, [redrawAnnotations]);

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
    setCanFlip(false);
    facingModeRef.current = "user"; // next call starts on the front camera
    // Reset the call-setup handshake so the next call starts clean.
    callRoleRef.current = null;
    acceptedRef.current = false;
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    resetAnnotations();
  }, [resetAnnotations]);

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
      if (pc.connectionState === "connected") {
        setCallStatus("in-call");
        setCallNotice(null);
        return;
      }
      if (pc.connectionState === "disconnected") {
        // Often transient — ICE may recover on its own. Reassure, don't kill.
        setCallNotice("Call connection unstable — text chat is unaffected.");
        return;
      }
      // Graceful degradation (SR-15): the peer link is gone for good. Tear
      // the call down cleanly; the chat socket is separate and keeps working.
      if (["failed", "closed"].includes(pc.connectionState) && pcRef.current === pc) {
        endCallMedia();
        setShowVideo(false);
        setCallNotice("Video call ended — text chat is still available.");
      }
    };

    pcRef.current = pc;
    return pc;
  }, [convId, endCallMedia]);

  // Callee side: runs only after the user has accepted the incoming call.
  const handleOffer = useCallback(async (offer) => {
    setCallStatus("connecting");
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

  // Caller side: once the callee accepts, build and send the SDP offer using
  // the local preview stream we already opened while ringing.
  const beginCallerOffer = useCallback(async () => {
    setCallStatus("connecting");
    const stream = localStreamRef.current || (await getLocalStream());
    const pc = createPeerConnection(iceServersRef.current);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("call:offer", { conversationId: convId, offer });
  }, [convId, getLocalStream, createPeerConnection]);

  // Cancel an outgoing call before it's answered (caller side, or on timeout).
  const cancelCall = useCallback((reason) => {
    clearRingTimeout();
    socketRef.current?.emit("call:cancel", { conversationId: convId });
    endCallMedia();
    setShowVideo(false);
    if (reason) setCallNotice(reason);
  }, [convId, endCallMedia, clearRingTimeout]);

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

      // Incoming call — show the accept/decline prompt instead of connecting (#3).
      socket.on("call:ring", ({ name }) => {
        if (cancelled) return;
        // Busy (already in or placing a call): auto-decline.
        if (callStatusRef.current !== "idle") {
          socket.emit("call:decline", { conversationId: convId });
          return;
        }
        callRoleRef.current = "callee";
        acceptedRef.current = false;
        if (name) setRemoteUserName(name);
        setCallNotice(null);
        setCallStatus("incoming");
      });

      // Callee accepted our outgoing call — send the SDP offer now.
      socket.on("call:accept", () => {
        if (cancelled || callRoleRef.current !== "caller") return;
        clearRingTimeout();
        beginCallerOffer().catch(() => {
          setThreadError("Failed to start the call.");
          endCallMedia();
          setShowVideo(false);
        });
      });

      // Callee declined our outgoing call.
      socket.on("call:decline", () => {
        if (cancelled || callRoleRef.current !== "caller") return;
        clearRingTimeout();
        endCallMedia();
        setShowVideo(false);
        setCallNotice(`${peerNameRef.current || "They"} declined the call.`);
      });

      // Caller cancelled before we (the callee) answered.
      socket.on("call:cancel", () => {
        if (cancelled || callStatusRef.current !== "incoming") return;
        callRoleRef.current = null;
        acceptedRef.current = false;
        setCallStatus("idle");
        setShowVideo(false);
        setCallNotice(`Missed call from ${peerNameRef.current || "them"}.`);
      });

      // Only accept an offer we're expecting — i.e. we accepted an incoming
      // call. This is what stops a call from connecting automatically (#3).
      socket.on("call:offer", ({ offer }) => {
        if (cancelled || callRoleRef.current !== "callee" || !acceptedRef.current) return;
        handleOffer(offer).catch(() => setThreadError("Failed to accept incoming call."));
      });

      socket.on("call:answer", ({ answer }) => {
        handleAnswer(answer).catch(() => {});
      });

      socket.on("call:ice-candidate", ({ candidate }) => {
        handleRemoteCandidate(candidate).catch(() => {});
      });

      socket.on("call:annotation", ({ stroke }) => {
        if (cancelled || !Array.isArray(stroke?.points)) return;
        peerStrokesRef.current.push(stroke);
        redrawAnnotations();
      });

      // Peer cleared THEIR drawings — remove only their strokes, keep mine (#2).
      socket.on("call:annotation-clear", () => {
        if (!cancelled) clearPeerStrokes();
      });

      socket.on("call:ended", () => {
        if (cancelled) return;
        endCallMedia();
        setShowVideo(false);
        setCallNotice("Call ended — text chat remains available.");
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
  }, [token, convId, user?.id, handleOffer, handleAnswer, handleRemoteCandidate, beginCallerOffer, endCallMedia, redrawAnnotations, clearPeerStrokes, clearRingTimeout]);

  // Annotation canvases size themselves at draw time — redraw when the layout changes
  useEffect(() => {
    globalThis.addEventListener("resize", redrawAnnotations);
    return () => globalThis.removeEventListener("resize", redrawAnnotations);
  }, [redrawAnnotations]);

  // #4 — warn before the tab is closed/refreshed while a call is active.
  useEffect(() => {
    if (!ACTIVE_CALL_STATES.includes(callStatus)) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = ""; // required for the native "Leave site?" prompt
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [callStatus]);

  // #4 — publish "call active" both to the parent (ConsultExpert, which guards
  // switching conversations mid-call) and to the shared CallGuardContext (which
  // the navbar reads to guard navigating away mid-call). Reset both on unmount.
  useEffect(() => {
    const active = ACTIVE_CALL_STATES.includes(callStatus);
    onCallActiveChange?.(active);
    setCallActive(active);
  }, [callStatus, onCallActiveChange, setCallActive]);
  useEffect(
    () => () => {
      onCallActiveChange?.(false);
      setCallActive(false);
    },
    [onCallActiveChange, setCallActive]
  );

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

  // Caller side (#3): ring the other participant and wait for them to accept
  // before any media is negotiated.
  async function startCall() {
    if (callStatus !== "idle") return;
    if (!counterpartOnline) {
      setCallNotice(`${counterpart?.name || "They"} must be logged in with this consultation open.`);
      return;
    }
    setCallNotice(null);
    callRoleRef.current = "caller";
    acceptedRef.current = false;
    setShowVideo(true);
    setCallStatus("ringing");
    try {
      await getLocalStream(); // local preview while ringing
      socketRef.current?.emit("call:ring", { conversationId: convId });
      clearRingTimeout();
      ringTimeoutRef.current = setTimeout(() => {
        cancelCall(`${counterpart?.name || "They"} didn't answer.`);
      }, RING_TIMEOUT_MS);
    } catch {
      setCallNotice("Could not access camera/microphone.");
      endCallMedia();
      setShowVideo(false);
    }
  }

  // Callee side (#3): accept the incoming call. The caller then sends the SDP
  // offer, and handleOffer opens our camera and answers.
  function acceptCall() {
    acceptedRef.current = true;
    setCallNotice(null);
    setShowVideo(true);
    setCallStatus("connecting");
    socketRef.current?.emit("call:accept", { conversationId: convId });
  }

  function declineCall() {
    socketRef.current?.emit("call:decline", { conversationId: convId });
    callRoleRef.current = null;
    acceptedRef.current = false;
    setShowVideo(false);
    setCallStatus("idle");
  }

  function hangUp() {
    // Tell the other side to tear down now instead of waiting for ICE to
    // time out — their chat keeps working either way (SR-15).
    socketRef.current?.emit("call:end", { conversationId: convId });
    endCallMedia();
    setShowVideo(false);
  }

  // ── Annotation pointer handlers (remote video canvas) ────────────
  function normPoint(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  }

  function handleDrawStart(e) {
    if (callStatus !== "in-call") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = { color: myColor, points: [normPoint(e)] };
  }

  function handleDrawMove(e) {
    const stroke = drawingRef.current;
    if (!stroke || stroke.points.length >= MAX_STROKE_POINTS) return;
    stroke.points.push(normPoint(e));
    redrawAnnotations();
  }

  function handleDrawEnd() {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke) return;
    if (stroke.points.length < 2) {
      redrawAnnotations();
      return;
    }
    myStrokesRef.current.push(stroke);
    redrawAnnotations();
    socketRef.current?.emit("call:annotation", { conversationId: convId, stroke });
  }

  // Clears only my own drawings and tells the peer to drop them too (#2).
  function clearAnnotations() {
    clearMyStrokes();
    socketRef.current?.emit("call:annotation-clear", { conversationId: convId });
  }

  return (
    <div style={s.thread}>
      <div className="orca-thread-header" style={s.header}>
        <div style={s.headerLeft}>
          <button
            type="button"
            className="orca-thread-back-btn"
            onClick={onBack}
            aria-label="Back to conversations"
            title="Back to conversations"
          >
            ←
          </button>
          <div style={s.headerTitles}>
            <h2 style={s.name}>{counterpart?.name}</h2>
            {counterpart?.bio && <p className="orca-thread-bio" style={s.bio}>{counterpart.bio}</p>}
          </div>
        </div>
        <div style={s.headerActions}>
          <span style={s.statusDot(counterpartOnline)} title={counterpartOnline ? "Online" : "Offline"} />
          <span style={s.statusText}>
            {counterpartOnline ? "Online" : "Offline"}
          </span>
          {callStatus === "idle" ? (
            <button
              className="orca-call-btn"
              style={{ ...s.callBtn, ...(!counterpartOnline ? s.callBtnDisabled : {}) }}
              onClick={startCall}
              disabled={status !== "connected" || !counterpartOnline}
              title={!counterpartOnline ? "Available when they open this consultation" : "Start video call"}
            >
              Video call
            </button>
          ) : callStatus === "incoming" ? null : callStatus === "ringing" ? (
            <button className="orca-hangup-btn" style={s.hangupBtn} onClick={() => cancelCall()}>
              Cancel
            </button>
          ) : (
            <button className="orca-hangup-btn" style={s.hangupBtn} onClick={hangUp}>
              {callStatus === "in-call" ? "End call" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      {callNotice && <div style={s.notice}>{callNotice}</div>}
      {threadError && <div style={s.error}>{threadError}</div>}

      {/* #3 — incoming call prompt: nothing connects until Accept is clicked */}
      {callStatus === "incoming" && (
        <div style={s.incomingOverlay}>
          <div style={s.incomingCard}>
            <div style={s.incomingIcon}>📹</div>
            <div style={s.incomingTitle}>Incoming video call</div>
            <div style={s.incomingName}>
              {remoteUserName || counterpart?.name || "Someone"} is calling…
            </div>
            <div style={s.incomingActions}>
              <button style={s.declineBtn} onClick={declineCall}>Decline</button>
              <button style={s.acceptBtn} onClick={acceptCall}>Accept</button>
            </div>
          </div>
        </div>
      )}

      {showVideo && (
        <>
          <div className="orca-video-grid" style={s.videoGrid}>
            <div className="orca-video-box" style={s.videoBox}>
              <video ref={localVideoRef} style={s.video} autoPlay muted playsInline>
                <track kind="captions" label="Captions unavailable" />
              </video>
              <canvas ref={localCanvasRef} style={s.annotationCanvas(false)} />
              <span style={s.videoLabel}>You</span>
              {canFlip && (
                <button
                  style={s.flipBtn}
                  onClick={flipCamera}
                  disabled={flipping}
                  title="Switch camera"
                  aria-label="Switch camera"
                >
                  {flipping ? "…" : "⟳ Flip"}
                </button>
              )}
            </div>
            <div className="orca-video-box" style={s.videoBox}>
              <video ref={remoteVideoRef} style={s.video} autoPlay playsInline>
                <track kind="captions" label="Captions unavailable" />
              </video>
              <canvas
                ref={remoteCanvasRef}
                role="application"
                aria-label="Draw annotations on remote video"
                style={s.annotationCanvas(callStatus === "in-call")}
                onPointerDown={handleDrawStart}
                onPointerMove={handleDrawMove}
                onPointerUp={handleDrawEnd}
                onPointerCancel={handleDrawEnd}
              />
              <span style={s.videoLabel}>{remoteUserName || counterpart?.name || "Waiting…"}</span>
              {(callStatus === "ringing" || callStatus === "connecting") && (
                <div style={s.callingOverlay}>
                  {callStatus === "ringing"
                    ? `Calling ${counterpart?.name || "…"}…`
                    : "Connecting…"}
                </div>
              )}
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
          {callStatus === "in-call" && (
            <div style={s.annotationBar}>
              <span style={s.annotationHint}>
                Draw on {counterpart?.name ? `${counterpart.name}'s` : "their"} video to point things out — they see it live.
              </span>
              <button style={s.annotationClearBtn} onClick={clearAnnotations}>
                Clear my drawings
              </button>
            </div>
          )}
        </>
      )}

      <div className="orca-chat-box" style={s.chatBox}>
        {messages.length === 0 && (
          <p style={s.emptyChat}>No messages yet — say hello to start.</p>
        )}
        {messages.map((msg) => {
          const isMe = (msg.sender_id ?? msg.uploader_id) === user?.id;
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

      <div className="orca-input-row" style={s.inputRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />
        <button
          className="orca-icon-btn"
          style={s.iconBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={status !== "connected" || uploading}
          title="Attach a photo or document"
        >
          📎
        </button>
        <button
          className="orca-icon-btn"
          style={{ ...s.iconBtn, ...(recording ? s.iconBtnActive : {}) }}
          onClick={() => (recording ? stopRecording() : startRecording())}
          disabled={status !== "connected" || uploading}
          title={recording ? "Stop recording" : "Record a voice message"}
        >
          {recording ? `⏹ ${recordSeconds}s` : "🎙️"}
        </button>
        <input
          className="orca-thread-input"
          style={s.input}
          placeholder={status === "connected" ? "Message…" : "Connecting…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={status !== "connected"}
        />
        <button className="orca-send-btn" style={s.sendBtn} onClick={sendMessage} disabled={status !== "connected" || !input.trim()}>
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
            <button type="button" style={s.thumbBtn} onClick={download} aria-label={`Download ${msg.original_filename}`}>
              <img src={objectUrl} alt={msg.original_filename} style={s.thumb} />
            </button>
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
        <audio controls src={objectUrl} style={{ width: 220 }}>
          <track kind="captions" label="Captions unavailable" />
        </audio>
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
  thread: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, position: "relative" },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--orca-line)", flexShrink: 0,
  },
  headerLeft: { display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 },
  headerTitles: { minWidth: 0 },
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
  flipBtn: { position: "absolute", top: 6, right: 6, padding: "4px 8px", borderRadius: 6, border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, cursor: "pointer", touchAction: "manipulation" },
  annotationCanvas: (drawable) => ({
    position: "absolute", inset: 0, width: "100%", height: "100%",
    pointerEvents: drawable ? "auto" : "none",
    cursor: drawable ? "crosshair" : "default",
    touchAction: "none",
  }),
  annotationBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 20px 0", flexShrink: 0 },
  annotationHint: { fontSize: 11, color: "var(--orca-muted)" },
  annotationClearBtn: { padding: "4px 10px", borderRadius: 6, border: "1px solid var(--orca-line)", background: "transparent", color: "var(--orca-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 },
  playBtn: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", padding: "8px 12px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 12, cursor: "pointer" },
  callingOverlay: {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: 14, background: "rgba(0,0,0,0.55)", textAlign: "center", padding: 12,
  },
  incomingOverlay: {
    position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center",
    justifyContent: "center", background: "rgba(0,0,0,0.6)", padding: 20,
  },
  incomingCard: {
    width: "100%", maxWidth: 320, background: "var(--orca-slate)", border: "1px solid var(--orca-line)",
    borderRadius: 14, padding: "24px 20px", textAlign: "center",
  },
  incomingIcon: { fontSize: 34, marginBottom: 8 },
  incomingTitle: { fontSize: 13, color: "var(--orca-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 },
  incomingName: { fontSize: 17, fontWeight: 600, color: "var(--orca-paper)", marginBottom: 20 },
  incomingActions: { display: "flex", gap: 10, justifyContent: "center" },
  acceptBtn: { flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#22c55e", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  declineBtn: { flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
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
  thumbBtn: { display: "block", padding: 0, border: "none", background: "none", cursor: "pointer", lineHeight: 0 },
  thumb: { display: "block", maxWidth: 220, maxHeight: 220, borderRadius: 8, objectFit: "cover" },
  thumbLoading: { width: 220, height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--orca-faint)", fontSize: 12, background: "rgba(255,255,255,0.05)", borderRadius: 8 },
  fileRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 },
  fileName: { fontSize: 12, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 },
  linkBtn: { background: "none", border: "none", color: "inherit", textDecoration: "underline", fontSize: 11, cursor: "pointer", padding: 0 },
  docRow: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "inherit", fontSize: 13, cursor: "pointer", padding: 0, textDecoration: "underline" },
};