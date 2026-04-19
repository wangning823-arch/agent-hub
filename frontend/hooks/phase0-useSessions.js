// Phase0: Skeleton hook for sessions (not implemented)
import { useState, useEffect } from 'react';

export function useSessions() {
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    // Placeholder: would fetch from API in Phase1
  }, []);
  return { sessions, setSessions };
}
