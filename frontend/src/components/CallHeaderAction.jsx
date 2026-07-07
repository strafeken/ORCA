export default function CallHeaderAction({
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
