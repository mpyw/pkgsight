import { useEffect, useState } from "react";
import type { DataSource } from "./source";
import type { CallStatus } from "./types";

// useCallStatus polls until the call graph, which the server builds after
// it starts, is ready or has failed.
export function useCallStatus(source: DataSource): CallStatus | undefined {
  const [status, setStatus] = useState<CallStatus>();
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      source.callStatus().then((s) => {
        if (!live) return;
        setStatus(s);
        if (s.state === "pending") timer = setTimeout(poll, 500);
      });
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source]);
  return status;
}
