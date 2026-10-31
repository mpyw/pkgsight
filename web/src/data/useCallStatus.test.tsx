// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSource } from "../test/fake";
import { useCallStatus } from "./useCallStatus";

afterEach(() => vi.useRealTimers());

describe("useCallStatus", () => {
  it("polls while pending, and stops once ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const src = new FakeSource({
      status: [{ state: "pending" }, { state: "ready", tookMs: 5 }],
    });
    const spy = vi.spyOn(src, "callStatus");
    const { result } = renderHook(() => useCallStatus(src));
    await waitFor(() => expect(result.current?.state).toBe("pending"));
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(result.current).toEqual({ state: "ready", tookMs: 5 });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failed request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const src = new FakeSource();
    const spy = vi
      .spyOn(src, "callStatus")
      .mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useCallStatus(src));
    await act(() => vi.advanceTimersByTimeAsync(600));
    await waitFor(() => expect(result.current?.state).toBe("ready"));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stops polling once unmounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const src = new FakeSource({ status: [{ state: "pending" }] });
    const spy = vi.spyOn(src, "callStatus");
    const { unmount } = renderHook(() => useCallStatus(src));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
