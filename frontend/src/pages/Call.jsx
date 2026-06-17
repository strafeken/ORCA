import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const CONVERSATION_ID = 1;

export default function Call() {
    const [userId, setUserId] = useState(null);
    const [iceServers, setIceServers] = useState([]);
    const [status, setStatus] = useState("disconnected");
    const [callStatus, setCallStatus] = useState("idle");
    const [remoteUserName, setRemoteUserName] = useState(null);
    const [iceState, setIceState] = useState("");
    const [gatherState, setGatherState] = useState("");
    const [candidateLog, setCandidateLog] = useState([]);
    const [trackDebug, setTrackDebug] = useState([]);
    const [needsPlayClick, setNeedsPlayClick] = useState(false);

    const socketRef = useRef(null);
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const pendingCandidatesRef = useRef([]);

    const createPeerConnection = useCallback((servers) => {
        if (!servers || servers.length === 0) {
            console.warn("ICE configurations are empty. Call might fail NAT traversal.");
        }

        const pc = new RTCPeerConnection({ iceServers: servers });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                setCandidateLog(prev => [...prev, `local: ${e.candidate.type} ${e.candidate.protocol}`]);
                socketRef.current?.emit("call:ice-candidate", {
                    conversationId: CONVERSATION_ID,
                    candidate: e.candidate,
                });
            } else {
                setCandidateLog(prev => [...prev, "local: gathering complete"]);
            }
        };

        pc.ontrack = (e) => {
            setTrackDebug(prev => [...prev, `ontrack fired, streams: ${e.streams.length}, videoRefExists: ${!!remoteVideoRef.current}`]);
            if (remoteVideoRef.current) {
                if (remoteVideoRef.current.srcObject !== e.streams[0]) {
                    remoteVideoRef.current.srcObject = e.streams[0];
                }
                remoteVideoRef.current.play()
                    .then(() => {
                        setTrackDebug(prev => [...prev, "play() succeeded"]);
                        setNeedsPlayClick(false);
                    })
                    .catch((err) => {
                        setTrackDebug(prev => [...prev, `play() failed: ${err.name}`]);
                        if (err.name === "NotAllowedError") {
                            setNeedsPlayClick(true);
                        }
                    });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "connected") setCallStatus("in-call");
            if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
                setCallStatus("idle");
            }
        };

        pc.oniceconnectionstatechange = () => {
            setIceState(pc.iceConnectionState);
        };

        pc.onicegatheringstatechange = () => {
            setGatherState(pc.iceGatheringState);
        };

        pcRef.current = pc;
        return pc;
    }, []);

    const getLocalStream = useCallback(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                googEchoCancellation: true,
                googNoiseSuppression: true
            } 
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
            await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCandidatesRef.current = [];
    }, []);

    const endCall = useCallback(() => {
        pcRef.current?.close();
        pcRef.current = null;
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        setCallStatus("idle");
        setIceState("");
        setGatherState("");
        setCandidateLog([]);
        setTrackDebug([]);
        setNeedsPlayClick(false);
    }, []);

    const handleOffer = useCallback(async (offer, currentServers) => {
        setCallStatus("calling");
        const stream = await getLocalStream();
        const pc = createPeerConnection(currentServers);
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingCandidates();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit("call:answer", { conversationId: CONVERSATION_ID, answer });
    }, [getLocalStream, createPeerConnection, flushPendingCandidates]);

    const handleAnswer = useCallback(async (answer) => {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingCandidates();
    }, [flushPendingCandidates]);

    const handleRemoteCandidate = useCallback(async (candidate) => {
        setCandidateLog(prev => [...prev, `remote: ${candidate.candidate?.includes("typ relay") ? "relay" : candidate.candidate?.includes("typ srflx") ? "srflx" : candidate.candidate?.includes("typ host") ? "host" : "unknown"}`]);
        if (!pcRef.current || !pcRef.current.remoteDescription) {
            pendingCandidatesRef.current.push(candidate);
            return;
        }
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    }, []);

    // Socket connection lifecycle
    useEffect(() => {
        if (!userId) return;

        let socket;

        const init = async () => {
            const res = await axios.get(`/api/auth/fake-login?userId=${userId}`);
            const { token } = res.data;

            let fetchedServers = []; // Track locally within initialization block
            try {
                const turnRes = await axios.get("/api/voip/turn-credentials", {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setIceServers(turnRes.data);
                fetchedServers = turnRes.data;
            } catch (err) {
                console.error("Failed to safely pull TURN parameters from API", err);
            }

            socket = io("/", { auth: { token }, path: "/socket.io" });

            socket.on("connect", () => {
                setStatus("connected");
                socket.emit("call:join", { conversationId: CONVERSATION_ID });
            });

            socket.on("connect_error", (err) => setStatus(`error: ${err.message}`));
            socket.on("call:user-joined", ({ name }) => setRemoteUserName(name));
            
            // Pass the local fetchedServers reference directly into the handler closure
            socket.on("call:offer", async ({ offer }) => { await handleOffer(offer, fetchedServers); });
            socket.on("call:answer", async ({ answer }) => { await handleAnswer(answer); });
            socket.on("call:ice-candidate", async ({ candidate }) => { await handleRemoteCandidate(candidate); });
            socket.on("call:user-left", () => { endCall(); setRemoteUserName(null); });
            socket.on("call:error", ({ message }) => alert(`Call error: ${message}`));
            socket.on("disconnect", () => setStatus("disconnected"));

            socketRef.current = socket;
        };

        init();

        return () => {
            endCall();
            socket?.disconnect();
            socketRef.current = null;
            setStatus("disconnected");
            setRemoteUserName(null);
        };
    }, [userId, handleOffer, handleAnswer, handleRemoteCandidate, endCall]);

    const startCall = async () => {
        setCallStatus("calling");
        const stream = await getLocalStream();
        
        // Reads directly from current live state configuration
        const pc = createPeerConnection(iceServers); 
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("call:offer", { conversationId: CONVERSATION_ID, offer });
    };

    const hangUp = () => {
        socketRef.current?.emit("call:leave", { conversationId: CONVERSATION_ID });
        endCall();
    };

    const selectUser = (uid) => setUserId(userId === uid ? null : uid);

    const s = {
        page: { padding: "2rem", fontFamily: "sans-serif", maxWidth: 700, margin: "0 auto" },
        title: { fontSize: 20, fontWeight: 500, marginBottom: 4 },
        subtitle: { fontSize: 13, color: "#888", marginBottom: "1.5rem" },
        userSelect: { display: "flex", gap: 8, marginBottom: "1rem" },
        userBtn: (active) => ({
            padding: "8px 16px", borderRadius: 8, border: "0.5px solid #ddd",
            cursor: "pointer", fontSize: 13,
            background: active ? "#222" : "white",
            color: active ? "white" : "#222",
        }),
        statusBar: { fontSize: 12, color: "#888", marginBottom: "0.75rem", lineHeight: 1.6 },
        debugBox: {
            fontSize: 11, fontFamily: "monospace", color: "#555",
            background: "#f5f5f3", borderRadius: 8, padding: "0.75rem",
            marginBottom: "1.5rem", maxHeight: 120, overflowY: "auto",
        },
        videoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1rem" },
        videoBox: { background: "#111", borderRadius: 12, overflow: "hidden", aspectRatio: "4/3", position: "relative" },
        video: { width: "100%", height: "100%", objectFit: "cover" },
        videoLabel: { position: "absolute", bottom: 8, left: 8, color: "white", fontSize: 11, background: "rgba(0,0,0,0.5)", padding: "2px 8px", borderRadius: 6 },
        controls: { display: "flex", gap: 8, justifyContent: "center" },
        callBtn: { padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: "#22c55e", color: "white" },
        hangupBtn: { padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: "#ef4444", color: "white" },
        playOverlayBtn: {
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            fontSize: 13, background: "#3b82f6", color: "white", whiteSpace: "nowrap",
        },
    };

    return (
        <div style={s.page}>
            <h1 style={s.title}>Video call test</h1>
            <p style={s.subtitle}>Connect as a user, then start a call</p>

            <div style={s.userSelect}>
                {["user-1", "user-2"].map(uid => (
                    <button key={uid} style={s.userBtn(userId === uid)} onClick={() => selectUser(uid)}>
                        {uid === "user-1" ? "John Doe (Worker)" : "Bob Chen (Expert)"}
                        {userId === uid ? " ✕" : ""}
                    </button>
                ))}
            </div>

            <div style={s.statusBar}>
                Status: {status} {remoteUserName && `· ${remoteUserName} is in the room`} · Call: {callStatus}
                <br />
                ICE connection: <strong>{iceState || "—"}</strong> · ICE gathering: <strong>{gatherState || "—"}</strong>
            </div>

            <div style={s.debugBox}>
                {candidateLog.length === 0 ? "No ICE candidates yet" : candidateLog.map((c, i) => <div key={i}>{c}</div>)}
            </div>

            <div style={s.debugBox}>
                {trackDebug.length === 0 ? "No track events yet" : trackDebug.map((t, i) => <div key={i}>{t}</div>)}
            </div>

            <div style={s.videoGrid}>
                <div style={s.videoBox}>
                    <video ref={localVideoRef} style={s.video} autoPlay muted playsInline />
                    <span style={s.videoLabel}>You</span>
                </div>
                <div style={s.videoBox}>
                    <video ref={remoteVideoRef} style={s.video} autoPlay playsInline />
                    <span style={s.videoLabel}>{remoteUserName || "Waiting..."}</span>
                    {needsPlayClick && (
                        <button
                            style={s.playOverlayBtn}
                            onClick={() => {
                                remoteVideoRef.current?.play()
                                    .then(() => setNeedsPlayClick(false))
                                    .catch(() => { /* still blocked, leave button visible */ });
                            }}
                        >
                            Click to start video
                        </button>
                    )}
                </div>
            </div>

            <div style={s.controls}>
                {callStatus === "idle" ? (
                    <button style={s.callBtn} onClick={startCall} disabled={status !== "connected" || iceServers.length === 0}>
                        Start Call
                    </button>
                ) : (
                    <button style={s.hangupBtn} onClick={hangUp}>
                        Hang Up
                    </button>
                )}
            </div>
        </div>
    );
}