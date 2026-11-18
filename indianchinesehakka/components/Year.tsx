"use client";

import { useEffect, useState } from "react";

/** Current year; refreshed on the client so a statically built page never shows a stale year. */
export function Year({ initial }: { initial: number }) {
  const [year, setYear] = useState(initial);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return <>{year}</>;
}
