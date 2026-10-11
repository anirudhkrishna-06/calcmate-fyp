import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

export function useLocalData<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError("");
    try { const next = await loader(); if (sequence.current === current) setData(next); }
    catch (e) { if (sequence.current === current) setError(e instanceof Error ? e.message : "Could not load local records."); }
    finally { if (sequence.current === current) setLoading(false); }
  }, [loader]);
  useFocusEffect(useCallback(() => { void reload(); return () => { sequence.current++; }; },[reload]));
  return { data, error, loading, reload };
}
