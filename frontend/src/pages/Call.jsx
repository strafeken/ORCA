import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const CONVERSATION_ID = 1;
const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
    },
];

export default function Call() {
    const [userId, setUserId] = useState(null);
    const [status, setStatus] = useState("disconnected");
    const [callStatus, setCallStatus] = useState("idle");
    const [remoteUserName, setRemoteUserName] = useState(null);

    const socketRef = useRef(null);
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const pendingCandidatesRef = useRef([]);

    const createPeerConnection = useCallback(() => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socketRef.current.emit("call:ice-candidate", {
                    conversationId: CONVERSATION_ID,
                    candidate: e.candidate,
                });
            }
        };

        pc.ontrack = (e) => {
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = e.streams[0];
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
    }, []);

    const getLocalStream = useCallback(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
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
    }, []);

    const handleOffer = useCallback(async (offer) => {
        setCallStatus("calling");
        const stream = await getLocalStream();
        const pc = createPeerConnection();
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingCandidates();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.emit("call:answer", { conversationId: CONVERSATION_ID, answer });
    }, [getLocalStream, createPeerConnection, flushPendingCandidates]);

    const handleAnswer = useCallback(async (answer) => {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingCandidates();
    }, [flushPendingCandidates]);

    const handleRemoteCandidate = useCallback(async (candidate) => {
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

            socket = io("/", { auth: { token }, path: "/socket.io" });

            socket.on("connect", () => {
                setStatus("connected");
                socket.emit("call:join", { conversationId: CONVERSATION_ID });
            });

            socket.on("connect_error", (err) => setStatus(`error: ${err.message}`));
            socket.on("call:user-joined", ({ name }) => setRemoteUserName(name));
            socket.on("call:offer", async ({ offer }) => { await handleOffer(offer); });
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
        const pc = createPeerConnection();
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit("call:offer", { conversationId: CONVERSATION_ID, offer });
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
        statusBar: { fontSize: 12, color: "#888", marginBottom: "1.5rem" },
        videoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1rem" },
        videoBox: { background: "#111", borderRadius: 12, overflow: "hidden", aspectRatio: "4/3", position: "relative" },
        video: { width: "100%", height: "100%", objectFit: "cover" },
        videoLabel: { position: "absolute", bottom: 8, left: 8, color: "white", fontSize: 11, background: "rgba(0,0,0,0.5)", padding: "2px 8px", borderRadius: 6 },
        controls: { display: "flex", gap: 8, justifyContent: "center" },
        callBtn: { padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: "#22c55e", color: "white" },
        hangupBtn: { padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: "#ef4444", color: "white" },
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
            </div>

            <div style={s.videoGrid}>
                <div style={s.videoBox}>
                    <video ref={localVideoRef} style={s.video} autoPlay muted playsInline />
                    <span style={s.videoLabel}>You</span>
                </div>
                <div style={s.videoBox}>
                    <video ref={remoteVideoRef} style={s.video} autoPlay playsInline />
                    <span style={s.videoLabel}>{remoteUserName || "Waiting..."}</span>
                </div>
            </div>

            <div style={s.controls}>
                {callStatus === "idle" ? (
                    <button style={s.callBtn} onClick={startCall} disabled={status !== "connected"}>
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