"use client";
import { useState, useEffect } from "react";

export function useTick(ms = 100) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(p => p + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}
