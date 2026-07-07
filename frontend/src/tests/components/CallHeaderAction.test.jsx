import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CallHeaderAction from "../../components/CallHeaderAction";

const styles = {
  callBtn: { background: "green" },
  callBtnDisabled: { opacity: 0.5 },
  hangupBtn: { background: "red" },
};

describe("CallHeaderAction", () => {
  test("shows Video call button when idle and counterpart online", () => {
    render(
      <CallHeaderAction
        callStatus="idle"
        counterpartOnline
        status="connected"
        onStartCall={vi.fn()}
        onCancelCall={vi.fn()}
        onHangUp={vi.fn()}
        styles={styles}
      />
    );
    expect(screen.getByRole("button", { name: "Video call" })).toBeEnabled();
  });

  test("shows Cancel while ringing", () => {
    const onCancelCall = vi.fn();
    render(
      <CallHeaderAction
        callStatus="ringing"
        counterpartOnline
        status="connected"
        onStartCall={vi.fn()}
        onCancelCall={onCancelCall}
        onHangUp={vi.fn()}
        styles={styles}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelCall).toHaveBeenCalled();
  });

  test("shows End call while in-call", () => {
    render(
      <CallHeaderAction
        callStatus="in-call"
        counterpartOnline
        status="connected"
        onStartCall={vi.fn()}
        onCancelCall={vi.fn()}
        onHangUp={vi.fn()}
        styles={styles}
      />
    );
    expect(screen.getByRole("button", { name: "End call" })).toBeInTheDocument();
  });
});
