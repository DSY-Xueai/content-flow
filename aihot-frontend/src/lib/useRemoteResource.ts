import { useEffect, useState } from 'react';
import { readResource, type Resource } from '../api/resources';

export function useRemoteResource<T>(url: string, refreshKey: number, minimumInterval = 60000) {
  const [state, setState] = useState<{ url: string; resource: Resource<T> | null; error: string | null; loading: boolean }>({ url, resource: null, error: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      setState((old) => ({ url, resource: old.url === url ? old.resource : null, error: old.url === url ? old.error : null, loading: true }));
      try {
        const resource = await readResource<T>(url, minimumInterval);
        if (!cancelled) setState({ url, resource, error: resource.warning ?? null, loading: false });
      } catch (error) {
        if (!cancelled) setState((old) => ({ ...old, loading: false, error: error instanceof Error ? error.message : '网络连接失败，请稍后重试' }));
      }
    };
    void load();
    const timer = window.setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('focus', load);
    };
  }, [url, refreshKey, minimumInterval]);
  return state.url === url ? state : { url, resource: null, error: null, loading: true };
}
