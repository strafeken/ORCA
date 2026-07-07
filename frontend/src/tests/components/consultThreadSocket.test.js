import { describe, test, expect, vi } from "vitest";
import {
  registerConsultThreadSocketHandlers,
  handlePeerConnectionStateChange,
  normPoint,
  isActiveCallState,
  ACTIVE_CALL_STATES,
} from "../../components/consultThreadSocket";

function createSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, fn) => {
      handlers[event] = fn;
    }),
    emit: vi.fn(),
    trigger(event, payload) {
      handlers[event]?.(payload);
    },
  };
}

function createHandlers(overrides = {}) {
  return {
    convId: 1,
    userId: 10,
    isCancelled: () => false,
    setStatus: vi.fn(),
    setMessages: vi.fn(),
    appendMessage: vi.fn(),
    onAnnotation: vi.fn(),
    setThreadError: vi.fn(),
    setCounterpartOnline: vi.fn(),
    setRemoteUserName: vi.fn(),
    setCallNotice: vi.fn(),
    getCallStatus: vi.fn(() => "idle"),
    getCallRole: vi.fn(() => null),
    isAccepted: vi.fn(() => false),
    onIncomingRing: vi.fn(),
    onCallerAccepted: vi.fn(),
    onCallerDeclined: vi.fn(),
    onCallerCancelled: vi.fn(),
    onRemoteOffer: vi.fn(),
    onRemoteAnswer: vi.fn(),
    onRemoteCandidate: vi.fn(),
    onRemoteAnnotation: vi.fn(),
    onRemoteAnnotationClear: vi.fn(),
    onCallEnded: vi.fn(),
    onUserLeft: vi.fn(),
    onCallError: vi.fn(),
    ...overrides,
  };
}

describe("consultThreadSocket", () => {
  test("registerConsultThreadSocketHandlers wires chat:message to appendMessage", () => {
    const socket = createSocket();
    const h = createHandlers();
    registerConsultThreadSocketHandlers(socket, h);

    const msg = { id: 1, content: "hi" };
    socket.trigger("chat:message", msg);

    expect(h.appendMessage).toHaveBeenCalledWith(msg);
  });

  test("registerConsultThreadSocketHandlers ignores events when cancelled", () => {
    const socket = createSocket();
    const h = createHandlers({ isCancelled: () => true });
    registerConsultThreadSocketHandlers(socket, h);

    socket.trigger("chat:message", { id: 1 });

    expect(h.appendMessage).not.toHaveBeenCalled();
  });

  test("call:ring auto-declines when not idle", () => {
    const socket = createSocket();
    const h = createHandlers({ getCallStatus: () => "in-call" });
    registerConsultThreadSocketHandlers(socket, h);

    socket.trigger("call:ring", { name: "Expert" });

    expect(socket.emit).toHaveBeenCalledWith("call:decline", { conversationId: 1 });
    expect(h.onIncomingRing).not.toHaveBeenCalled();
  });

  test("call:ring shows incoming prompt when idle", () => {
    const socket = createSocket();
    const h = createHandlers({ getCallStatus: () => "idle" });
    registerConsultThreadSocketHandlers(socket, h);

    socket.trigger("call:ring", { name: "Expert" });

    expect(h.onIncomingRing).toHaveBeenCalledWith("Expert");
  });

  test("normPoint normalizes pointer coordinates to 0..1", () => {
    const target = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    };
    const point = normPoint({ currentTarget: target, clientX: 100, clientY: 50 });
    expect(point).toEqual({ x: 0.5, y: 0.5 });
  });

  test("isActiveCallState reflects ACTIVE_CALL_STATES set", () => {
    expect(isActiveCallState("in-call")).toBe(true);
    expect(isActiveCallState("idle")).toBe(false);
    expect(ACTIVE_CALL_STATES.has("ringing")).toBe(true);
  });

  test("handlePeerConnectionStateChange invokes ended callback on failed state", () => {
    const pc = { connectionState: "failed" };
    const callbacks = { onConnected: vi.fn(), onUnstable: vi.fn(), onEnded: vi.fn() };

    handlePeerConnectionStateChange(pc, pc, callbacks);

    expect(callbacks.onEnded).toHaveBeenCalled();
  });
});
