import { useCallback, useState } from 'react';
import { uid } from '@/lib/utils';

export function useRequestId() {
  const [id, setId] = useState<string>(() => uid());
  const refresh = useCallback(() => setId(uid()), []);
  return { requestId: id, refresh };
}
