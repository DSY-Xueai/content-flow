import {
  Bot,
  Bookmark,
  CalendarDays,
  Check,
  ExternalLink,
  Flame,
  List,
  LayoutGrid,
  Monitor,
  Moon,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Plus,
  RefreshCw,
  Radio,
  Search,
  Sun,
  Trophy,
  X,
  Zap
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  addAgentMaterial,
  clearAgentMaterials,
  confirmAgentDraft,
  deleteAgentMaterial,
  fetchAgentDraft,
  fetchAgentHistory,
  fetchAgentLogs,
  fetchAgentMaterials,
  fetchCurrentAgentJob,
  regenerateAgentDraft,
  restartAgentJob,
  resumeAgentJob,
  retryAgentJob,
  saveAgentDraft,
  startAgentJob,
  startAgentMarkdownJob,
  stopAgentJob,
  type AgentHistoryEntry,
  type AgentJob,
  type AgentLogEntry,
  type AgentMaterial,
  type AgentStepId
} from './api/agent';
import { fetchDaily, fetchItems, type AihotItem, type DailyResponse, type FeedCursor, type FeedMode, type FeedResponse } from './api/aihot';
import {
  DEFAULT_X_HANDLES,
  fetchLatestXPosts,
  fillMissingXSourceItems,
  loadPersistedXHandles,
  mergeXHandles,
  normalizeXHandle,
  readStoredXHandles,
  saveStoredXHandles,
  type XSourceItem
} from './api/xSources';
import { FeedTimeline } from './components/FeedTimeline';
import { BookmarksPanel } from './components/BookmarksPanel';
import { HotTopicsPanel } from './components/HotTopicsPanel';
import { LeaderboardPanel } from './components/LeaderboardPanel';
import { ResetsPanel } from './components/ResetsPanel';
import { TopicsPanel } from './components/TopicsPanel';
import type { FeatureState } from './components/SyncStatus';
import { SyncHealthPanel } from './components/SyncHealthPanel';
import { StatusView } from './components/StatusView';
import { categories, getCategoryLabel, type CategoryId } from './lib/categories';
import { formatBeijingTime } from './lib/time';
import { useBookmarks } from './lib/bookmarks';

type ViewId = 'selected' | 'all' | 'hot' | 'daily' | 'topics' | 'starred' | 'leaderboard' | 'resets' | 'agent' | 'sources';
type AgentPublishMode = 'topic' | 'materials' | 'markdown';
type Theme = 'light' | 'system' | 'dark';

const FEED_PAGE_SIZE = 40;
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_MARKDOWN_BYTES = 1024 * 1024;

const navItems = [
  { id: 'selected', label: '精选', icon: Zap, section: '内容' },
  { id: 'all', label: '全部 AI 动态', icon: List, section: '内容' },
  { id: 'hot', label: '热点榜', icon: Flame, section: '内容' },
  { id: 'daily', label: 'AI 日报', icon: Newspaper, section: '内容' },
  { id: 'topics', label: '主题', icon: LayoutGrid, section: '内容' },
  { id: 'starred', label: '收藏', icon: Bookmark, section: '内容' },
  { id: 'leaderboard', label: '模型榜', icon: Trophy, section: '模型' },
  { id: 'resets', label: 'Tibo 重置监控', icon: CalendarDays, section: '模型' },
  { id: 'agent', label: 'Agent 接入', icon: Bot, section: '工作台' },
  { id: 'sources', label: '特定来源', icon: Radio, section: '工作台' }
] satisfies Array<{ id: ViewId; label: string; icon: typeof Zap; section: string }>;

const themes = [
  { id: 'dark', label: '深色模式', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor },
  { id: 'light', label: '浅色模式', icon: Sun }
] satisfies Array<{ id: Theme; label: string; icon: typeof Sun }>;

export function App() {
  const [view, setView] = useState<ViewId>('selected');
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('paixiaoxin.sidebar');
    return saved === null ? window.innerWidth >= 700 : saved === 'open';
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('paixiaoxin.theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [category, setCategory] = useState<CategoryId>('all');
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AihotItem[]>([]);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [nextCursor, setNextCursor] = useState<FeedCursor | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sourceRefreshKey, setSourceRefreshKey] = useState(0);
  const [featureState, setFeatureState] = useState<FeatureState>({ loading: true, error: null });
  const [lastFeedSyncAt, setLastFeedSyncAt] = useState<number | null>(null);
  const [feedSyncError, setFeedSyncError] = useState<string | null>(null);
  const [pendingFeed, setPendingFeed] = useState<FeedResponse | null>(null);
  const lastFeedAttemptRef = useRef(0);
  const bookmarks = useBookmarks();
  const bookmarkIds = useMemo(() => new Set(bookmarks.items.map((entry) => entry.item.id)), [bookmarks.items]);
  const [customHandles, setCustomHandles] = useState<string[]>(() => readStoredXHandles());
  const [sourceInput, setSourceInput] = useState('');
  const [sourceItems, setSourceItems] = useState<XSourceItem[]>([]);
  const [sourceLoadedKey, setSourceLoadedKey] = useState<string | null>(null);
  const [sourceLoadedAt, setSourceLoadedAt] = useState<number | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [agentMaterials, setAgentMaterials] = useState<AgentMaterial[]>([]);
  const [agentTopic, setAgentTopic] = useState('');
  const [agentPublishMode, setAgentPublishMode] = useState<AgentPublishMode>('topic');
  const [agentMarkdownFile, setAgentMarkdownFile] = useState<File | null>(null);
  const [agentJob, setAgentJob] = useState<AgentJob | null>(null);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [agentHistory, setAgentHistory] = useState<AgentHistoryEntry[]>([]);
  const [agentDraft, setAgentDraft] = useState('');
  const [agentRevision, setAgentRevision] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStopping, setAgentStopping] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const agentActionVersionRef = useRef(0);
  const agentMarkdownReadingRef = useRef(false);
  const agentPollRef = useRef<number | null>(null);
  const agentRecoveryPollRef = useRef<number | null>(null);
  const sidebarToggleButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarToggleFocusPendingRef = useRef(false);

  const feedMode: FeedMode = view === 'all' ? 'all' : 'selected';
  const activeFeed = view === 'selected' || view === 'all';
  const activeSources = view === 'sources';
  const activeAgent = view === 'agent';
  const activeRemoteFeature = view === 'hot' || view === 'topics' || view === 'leaderboard' || view === 'resets';
  const sourceHandles = useMemo(() => mergeXHandles(DEFAULT_X_HANDLES, customHandles), [customHandles]);
  const sourceHandleKey = sourceHandles.join(',');
  const sourceCacheKey = `${sourceHandleKey}|${sourceRefreshKey}`;
  const agentMaterialIds = useMemo(() => new Set(agentMaterials.map((item) => item.id)), [agentMaterials]);
  const displayedSourceItems = useMemo(
    () => fillMissingXSourceItems(sourceHandles, sourceItems),
    [sourceHandles, sourceItems]
  );

  function clearAgentPoll(expectedPoll: number | null = null) {
    const currentPoll = agentPollRef.current;
    if (currentPoll === null || (expectedPoll !== null && currentPoll !== expectedPoll)) return;
    window.clearInterval(currentPoll);
    agentPollRef.current = null;
  }

  function clearAgentRecoveryPoll(expectedPoll: number | null = null) {
    const currentPoll = agentRecoveryPollRef.current;
    if (currentPoll === null || (expectedPoll !== null && currentPoll !== expectedPoll)) return;
    window.clearInterval(currentPoll);
    agentRecoveryPollRef.current = null;
  }

  function toggleSidebar() {
    sidebarToggleFocusPendingRef.current = true;
    setSidebarOpen((open) => !open);
  }

  useEffect(() => () => clearAgentPoll(), []);
  useEffect(() => () => clearAgentRecoveryPoll(), []);

  useEffect(() => {
    localStorage.setItem('paixiaoxin.sidebar', sidebarOpen ? 'open' : 'collapsed');
  }, [sidebarOpen]);

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (preference?.matches ? 'dark' : 'light') : theme;
    };
    applyTheme();
    localStorage.setItem('paixiaoxin.theme', theme);
    preference?.addEventListener('change', applyTheme);
    return () => preference?.removeEventListener('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (window.innerWidth >= 700) return;
      if (event.key === 'Escape') toggleSidebar();
      if (event.key === 'Tab') {
        const sidebar = document.getElementById('workspace-sidebar');
        const buttons = sidebar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarToggleFocusPendingRef.current) return;
    sidebarToggleButtonRef.current?.focus();
    sidebarToggleFocusPendingRef.current = false;
  }, [sidebarOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadStoredSources() {
      const storedHandles = await loadPersistedXHandles();
      if (!cancelled) {
        setCustomHandles(storedHandles);
      }
    }

    loadStoredSources();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setFeedSyncError(null);
      setPendingFeed(null);
      if (activeFeed || view === 'daily') lastFeedAttemptRef.current = Date.now();

      try {
        if (view === 'daily') {
          const nextDaily = await fetchDaily();
          if (!cancelled) {
            setDaily(nextDaily);
            setLastFeedSyncAt(nextDaily.syncedAt ?? Date.now());
            setFeedSyncError(nextDaily.syncWarning ?? null);
          }
          return;
        }

        if (activeFeed) {
          const response = await fetchItems({
            mode: feedMode,
            category,
            q: query,
            take: FEED_PAGE_SIZE
          });
          if (!cancelled) {
            setItems(response.items);
            setHasNext(Boolean(response.hasNext));
            setNextCursor(response.nextCursor ?? null);
            setLastFeedSyncAt(response.syncedAt ?? Date.now());
            setFeedSyncError(response.syncWarning ?? null);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '未知错误');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [activeFeed, category, feedMode, query, refreshKey, view]);

  useEffect(() => {
    if ((!activeFeed && view !== 'daily') || loading) return;
    let cancelled = false;
    const sync = async () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastFeedAttemptRef.current < 60000) return;
      lastFeedAttemptRef.current = Date.now();
      try {
        if (view === 'daily') {
          const result = await fetchDaily();
          if (!cancelled) {
            setDaily(result);
            setLastFeedSyncAt(result.syncedAt ?? Date.now());
            setFeedSyncError(result.syncWarning ?? null);
          }
        } else {
          const response = await fetchItems({ mode: feedMode, category, q: query, take: FEED_PAGE_SIZE });
          if (cancelled) return;
          setLastFeedSyncAt(response.syncedAt ?? Date.now());
          setFeedSyncError(response.syncWarning ?? null);
          if (items.length > FEED_PAGE_SIZE) {
            if (response.items[0]?.id !== items[0]?.id) setPendingFeed(response);
          } else {
            setItems(response.items);
            setNextCursor(response.nextCursor ?? null);
            setHasNext(Boolean(response.hasNext));
          }
        }
        if (!cancelled) setError(null);
      } catch (error) {
        if (!cancelled) setFeedSyncError(error instanceof Error ? error.message : '网络连接失败');
      }
    };
    const timer = window.setInterval(sync, 60000);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [activeFeed, view, loading, feedMode, category, query, items.length, items[0]?.id]);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const cacheFresh =
      sourceLoadedKey === sourceCacheKey &&
      sourceLoadedAt !== null &&
      now - sourceLoadedAt < SOURCE_CACHE_TTL_MS;

    if (cacheFresh) {
      return () => {
        cancelled = true;
      };
    }

    async function loadSources() {
      setSourceLoading(true);
      setSourceError(null);

      try {
        const response = await fetchLatestXPosts(sourceHandles, sourceRefreshKey > 0);
        if (!cancelled) {
          setSourceItems(response);
          setSourceLoadedKey(sourceCacheKey);
          setSourceLoadedAt(Date.now());
        }
      } catch (loadError) {
        if (!cancelled) {
          setSourceError(loadError instanceof Error ? loadError.message : '未知错误');
        }
      } finally {
        if (!cancelled) {
          setSourceLoading(false);
        }
      }
    }

    loadSources();

    return () => {
      cancelled = true;
    };
  }, [sourceCacheKey, sourceHandleKey]);

  useEffect(() => {
    if (!activeSources || sourceLoadedKey !== sourceCacheKey || sourceLoadedAt === null) {
      return;
    }

    if (Date.now() - sourceLoadedAt < SOURCE_CACHE_TTL_MS) {
      return;
    }

    let cancelled = false;

    async function refreshStaleSources() {
      setSourceLoading(true);
      setSourceError(null);

      try {
        const response = await fetchLatestXPosts(sourceHandles);
        if (!cancelled) {
          setSourceItems(response);
          setSourceLoadedKey(sourceCacheKey);
          setSourceLoadedAt(Date.now());
        }
      } catch (loadError) {
        if (!cancelled) {
          setSourceError(loadError instanceof Error ? loadError.message : '未知错误');
        }
      } finally {
        if (!cancelled) {
          setSourceLoading(false);
        }
      }
    }

    refreshStaleSources();

    return () => {
      cancelled = true;
    };
  }, [activeSources, sourceCacheKey, sourceHandles, sourceLoadedAt, sourceLoadedKey]);

  useEffect(() => {
    if (!activeAgent) {
      return;
    }

    let cancelled = false;

    async function loadAgentState() {
      setAgentLoading(true);
      setAgentError(null);

      try {
        const [materials, currentJob, history] = await Promise.all([
          fetchAgentMaterials(),
          fetchCurrentAgentJob(),
          fetchAgentHistory()
        ]);
        if (cancelled) return;

        setAgentMaterials(materials);
        setAgentHistory(history);
        setAgentJob(currentJob);

        if (currentJob) {
          const [logs, draft] = await Promise.all([
            fetchAgentLogs(currentJob.id),
            currentJob.status === 'waiting_review' ? fetchAgentDraft(currentJob.id) : Promise.resolve('')
          ]);
          if (!cancelled) {
            setAgentLogs(logs);
            setAgentDraft(draft);
          }
        } else {
          setAgentLogs([]);
          setAgentDraft('');
        }
      } catch (loadError) {
        if (!cancelled) {
          setAgentError(loadError instanceof Error ? loadError.message : 'Agent 状态读取失败');
        }
      } finally {
        if (!cancelled) {
          setAgentLoading(false);
        }
      }
    }

    loadAgentState();

    return () => {
      cancelled = true;
    };
  }, [activeAgent]);

  useEffect(() => {
    if (!activeAgent || agentBusy || agentJob?.status !== 'running') {
      return;
    }

    const actionVersion = agentActionVersionRef.current;
    let cancelled = false;
    const poll = window.setInterval(() => {
      fetchCurrentAgentJob()
        .then(async (nextJob) => {
          if (cancelled || actionVersion !== agentActionVersionRef.current) return;
          await applyAgentJob(nextJob, actionVersion, () => !cancelled);
          if (cancelled || actionVersion !== agentActionVersionRef.current) return;

          if (!nextJob || nextJob.status === 'running' || nextJob.status === 'waiting_review') return;
          const history = await fetchAgentHistory();
          if (!cancelled && actionVersion === agentActionVersionRef.current) {
            setAgentHistory(history);
          }
        })
        .catch(() => undefined);
    }, 1500);
    agentRecoveryPollRef.current = poll;

    return () => {
      cancelled = true;
      clearAgentRecoveryPoll(poll);
    };
  }, [activeAgent, agentBusy, agentJob?.status]);

  const subtitle = useMemo(() => {
    if (view === 'selected') return '与 AIHOT 时间线同步，按网站收录顺序展示';
    if (view === 'all') return '最新动态与检索，每分钟检查更新';
    if (view === 'hot') return '过去 48 小时 AI 热点 Top 10';
    if (view === 'daily') return '按主题板块整理的 AI 日报';
    if (view === 'topics') return '按公司、技术方向与内容类型追踪精选';
    if (view === 'starred') return '保存在当前浏览器的内容与备份';
    if (view === 'leaderboard') return '第三方实测成绩、模型评分与参考价格';
    if (view === 'resets') return 'Tibo 的额度重置、重置卡发放与原帖';
    if (view === 'agent') return '自动发文任务、素材篮和公众号草稿发布流程';
    if (view === 'sources') return '指定 X 账号的最新一条发布信息';
    return '信息源工作台';
  }, [view]);

  const activeCategoryLabel = category === 'all' ? '全部分类' : getCategoryLabel(category);
  const currentTitle = navItems.find((item) => item.id === view)?.label ?? '精选';
  const activeLoading = activeRemoteFeature ? featureState.loading : view === 'starred' ? false : activeSources ? sourceLoading && !sourceItems.length : activeAgent ? agentLoading : loading;
  const activeError = activeRemoteFeature ? featureState.error : view === 'starred' ? null : activeSources ? sourceError : activeAgent ? agentError : error ?? feedSyncError;
  const sourceStatus = activeLoading ? 'syncing' : activeError ? 'error' : 'ok';
  const sourceStatusText = activeLoading ? '同步中' : activeError ? '信息源异常' : '信息源正常';

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchText.trim());
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const handle = normalizeXHandle(sourceInput);
    if (!handle) {
      setError('请输入有效的 X 账号链接或 handle');
      return;
    }

    const nextHandles = mergeXHandles(customHandles, [handle]);
    setCustomHandles(nextHandles);
    setSourceInput('');
    setError(null);

    try {
      const savedHandles = await saveStoredXHandles(nextHandles);
      setCustomHandles(savedHandles);
    } catch (saveError) {
      setSourceError(saveError instanceof Error ? saveError.message : '账号保存失败');
    }
  }

  async function loadMoreItems() {
    if (!activeFeed || !nextCursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setError(null);

    try {
      const response = await fetchItems({
        mode: feedMode,
        category,
        q: query,
        take: FEED_PAGE_SIZE,
        cursor: nextCursor
      });
      setItems((currentItems) => {
        const seen = new Set(currentItems.map((item) => item.id));
        const freshItems = response.items.filter((item) => !seen.has(item.id));
        return [...currentItems, ...freshItems];
      });
      setHasNext(Boolean(response.hasNext));
      setNextCursor(response.nextCursor ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '未知错误');
    } finally {
      setLoadingMore(false);
    }
  }

  async function applyAgentJob(nextJob: AgentJob | null, actionVersion?: number, isActive: () => boolean = () => true) {
    const isCurrentAction = () => isActive() && (actionVersion === undefined || agentActionVersionRef.current === actionVersion);
    if (!isCurrentAction()) return;

    if (!nextJob) {
      setAgentJob(null);
      setAgentLogs([]);
      setAgentDraft('');
      return;
    }

    const [logs, draft] = await Promise.all([
      fetchAgentLogs(nextJob.id),
      nextJob.status === 'waiting_review' ? fetchAgentDraft(nextJob.id) : Promise.resolve(agentDraft)
    ]);
    if (!isCurrentAction()) return;
    setAgentJob(nextJob);
    setAgentLogs(logs);
    if (nextJob.status === 'waiting_review') {
      setAgentDraft(draft);
    }
  }

  async function runAgentAction(action: () => Promise<AgentJob>): Promise<boolean> {
    clearAgentPoll();
    const actionVersion = ++agentActionVersionRef.current;
    setAgentBusy(true);
    setAgentError(null);
    const poll = window.setInterval(() => {
      fetchCurrentAgentJob()
        .then((job) => {
          if (actionVersion === agentActionVersionRef.current && job && job.status !== 'waiting_review') {
            setAgentJob(job);
          }
        })
        .catch(() => undefined);
    }, 1500);
    agentPollRef.current = poll;

    try {
      const nextJob = await action();
      if (actionVersion !== agentActionVersionRef.current) return false;
      await applyAgentJob(nextJob, actionVersion);
      const history = await fetchAgentHistory();
      if (actionVersion !== agentActionVersionRef.current) return false;
      setAgentHistory(history);
      return true;
    } catch (actionError) {
      if (actionVersion === agentActionVersionRef.current) {
        setAgentError(actionError instanceof Error ? actionError.message : 'Agent 操作失败');
      }
      return false;
    } finally {
      clearAgentPoll(poll);
      if (actionVersion === agentActionVersionRef.current) {
        setAgentBusy(false);
      }
    }
  }

  async function stopCurrentAgentJob() {
    if (!agentJob || agentJob.status !== 'running' || agentStopping) return;

    clearAgentPoll();
    const actionVersion = ++agentActionVersionRef.current;
    setAgentStopping(true);
    setAgentError(null);
    try {
      const nextJob = await stopAgentJob(agentJob.id);
      if (actionVersion !== agentActionVersionRef.current) return;
      await applyAgentJob(nextJob, actionVersion);
      const history = await fetchAgentHistory();
      if (actionVersion !== agentActionVersionRef.current) return;
      setAgentHistory(history);
    } catch (stopError) {
      if (actionVersion === agentActionVersionRef.current) {
        setAgentError(stopError instanceof Error ? stopError.message : '停止 Agent 任务失败');
        try {
          const currentJob = await fetchCurrentAgentJob();
          if (actionVersion === agentActionVersionRef.current) {
            await applyAgentJob(currentJob, actionVersion);
          }
        } catch {
          // 保留停止请求的原始错误，状态刷新失败不覆盖它。
        }
        try {
          const history = await fetchAgentHistory();
          if (actionVersion === agentActionVersionRef.current) {
            setAgentHistory(history);
          }
        } catch {
          // 保留停止请求的原始错误，历史刷新失败不覆盖它。
        }
      }
    } finally {
      if (actionVersion === agentActionVersionRef.current) {
        setAgentBusy(false);
        setAgentStopping(false);
      }
    }
  }

  async function addAihotToAgent(item: AihotItem) {
    try {
      setAgentError(null);
      setAgentMaterials(
        await addAgentMaterial({
          sourceType: 'aihot',
          item: {
            id: item.id,
            title: item.title,
            summary: item.summary ?? ''
          }
        })
      );
    } catch (addError) {
      setAgentError(addError instanceof Error ? addError.message : '加入素材失败');
    }
  }

  async function addXToAgent(item: XSourceItem) {
    if (!item.latestPost) {
      return;
    }

    try {
      setAgentError(null);
      setAgentMaterials(
        await addAgentMaterial({
          sourceType: 'x',
          item: {
            handle: item.handle,
            displayName: item.displayName ?? item.handle,
            latestPost: {
              text: item.latestPost.text,
              translatedText: item.latestPost.translatedText
            }
          }
        })
      );
    } catch (addError) {
      setAgentError(addError instanceof Error ? addError.message : '加入素材失败');
    }
  }

  async function removeAgentMaterial(id: string) {
    try {
      setAgentMaterials(await deleteAgentMaterial(id));
    } catch (removeError) {
      setAgentError(removeError instanceof Error ? removeError.message : '删除素材失败');
    }
  }

  async function clearAgentMaterialList() {
    try {
      setAgentMaterials(await clearAgentMaterials());
    } catch (clearError) {
      setAgentError(clearError instanceof Error ? clearError.message : '清空素材失败');
    }
  }

  async function submitAgentJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (agentPublishMode === 'markdown') {
      if (!agentMarkdownFile) {
        setAgentError('请选择 Markdown 文件');
        return;
      }
      if (!/\.(?:md|markdown)$/i.test(agentMarkdownFile.name)) {
        setAgentError('请选择 .md 或 .markdown 文件');
        return;
      }
      if (agentMarkdownFile.size > MAX_MARKDOWN_BYTES) {
        setAgentError('Markdown 文件不能超过 1 MiB');
        return;
      }
      if (agentMarkdownReadingRef.current) {
        return;
      }
      const file = agentMarkdownFile;
      agentMarkdownReadingRef.current = true;
      setAgentBusy(true);
      setAgentError(null);
      try {
        const buffer = await file.arrayBuffer();
        let markdown = '';
        try {
          markdown = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
          setAgentError('Markdown 文件必须是 UTF-8 编码');
          return;
        }
        if (!markdown.trim()) {
          setAgentError('Markdown 文件内容不能为空');
          return;
        }
        await runAgentAction(() => startAgentMarkdownJob(file.name, markdown));
      } catch (readError) {
        setAgentError(readError instanceof Error ? readError.message : '读取 Markdown 文件失败');
      } finally {
        agentMarkdownReadingRef.current = false;
        setAgentBusy(false);
      }
      return;
    }

    const topic = agentTopic.trim();
    if (agentPublishMode === 'topic' && !topic) {
      setAgentError('请输入发文主题');
      return;
    }
    if (agentPublishMode === 'materials' && !agentMaterials.length) {
      setAgentError('请先加入素材');
      return;
    }
    await runAgentAction(() => startAgentJob(agentPublishMode === 'materials' ? '' : topic));
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">跳到主要内容</a>
      <main className={`workspace${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
        <aside className="sidebar" id="workspace-sidebar" aria-label="工作台侧栏" data-collapsed={!sidebarOpen}>
          <div className="sidebar-heading">
            <div className="brand" title="派小芯 · 信息源工作台">
              <span className="brand-mark">AI</span>
              <div className="brand-name">
                <strong>派小芯</strong>
                <small>信息源工作台</small>
              </div>
            </div>
            <SidebarToggleButton buttonRef={sidebarToggleButtonRef} open={sidebarOpen} onToggle={toggleSidebar} />
          </div>
          <nav className="nav-tabs" aria-label="主导航">
            {navItems.map((item, index) => (
              <div key={item.id} className={index > 0 && navItems[index - 1].section !== item.section ? 'nav-group-start' : undefined}>
                {index === 0 || navItems[index - 1].section !== item.section ? <p className="nav-section-label">{item.section}</p> : null}
                <button
                  aria-current={view === item.id ? 'page' : undefined}
                  aria-label={item.label}
                  className={view === item.id ? 'active' : ''}
                  onClick={() => {
                    setView(item.id);
                    if (window.innerWidth < 700) setSidebarOpen(false);
                  }}
                  title={sidebarOpen ? undefined : item.label}
                  type="button"
                >
                  <item.icon aria-hidden="true" size={18} strokeWidth={1.7} />
                  <span className="nav-label">{item.label}</span>
                  {item.id === 'agent' && agentMaterials.length ? <span className="nav-count">{agentMaterials.length}</span> : null}
                  {item.id === 'starred' && bookmarks.items.length ? <span className="nav-count">{bookmarks.items.length}</span> : null}
                </button>
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className={`source-status ${sourceStatus}`} role="status" aria-label={`信息源状态：${sourceStatus === 'ok' ? '正常' : sourceStatusText}`} title={sourceStatusText}>
              <span className="status-dot" />
              <span className="sidebar-detail">{sourceStatusText}</span>
            </div>
            <div className="theme-switch" role="group" aria-label="外观">
              {themes.map((item) => (
                <button aria-label={item.label} aria-pressed={theme === item.id} key={item.id} onClick={() => setTheme(item.id)} title={item.label} type="button">
                  <item.icon aria-hidden="true" size={15} strokeWidth={1.7} />
                </button>
              ))}
            </div>
            <p className="sidebar-detail sidebar-caption">{view === 'starred' ? '收藏仅保存在本机' : activeSources ? 'X 公开信息源' : '资讯来自 AIHOT'}</p>
          </div>
        </aside>
        {sidebarOpen ? <button className="sidebar-scrim" aria-label="关闭导航遮罩" tabIndex={-1} type="button" onClick={toggleSidebar} /> : null}

        <section className={`content${activeAgent ? ' content-agent' : ''}`} id="workspace-content" tabIndex={-1}>
          {!activeAgent ? (
              <header className="content-header">
                <div className="hero-copy">
                  <h1>{currentTitle}</h1>
                  <p>{subtitle}</p>
                </div>
                {view !== 'starred' ? <button className="icon-button" type="button" onClick={() => activeSources ? setSourceRefreshKey((value) => value + 1) : setRefreshKey((value) => value + 1)}>
                  <RefreshCw size={17} />
                  刷新
                </button> : null}
              </header>
          ) : null}

          <SyncHealthPanel refreshKey={refreshKey} />
          {bookmarks.notice ? <div className="feature-warning" role="status"><p>{bookmarks.notice}</p><button className="ghost-button" aria-label="关闭收藏提示" type="button" onClick={bookmarks.dismissNotice}>关闭</button></div> : null}
          {(activeFeed || view === 'daily') && lastFeedSyncAt ? <p className="data-timestamp" role="status">最近检查 {new Date(lastFeedSyncAt).toLocaleTimeString('zh-CN', { hour12: false })} · 每分钟同步{items.length > FEED_PAGE_SIZE && activeFeed ? ' · 当前分页为已载入的浏览快照' : ''}</p> : null}
          {feedSyncError && (activeFeed || view === 'daily') ? <div className="feature-warning" role="status">自动同步失败，正在保留上次数据：{feedSyncError}</div> : null}
          {pendingFeed && activeFeed ? <button className="new-items-banner" type="button" onClick={() => { setItems(pendingFeed.items); setNextCursor(pendingFeed.nextCursor ?? null); setHasNext(Boolean(pendingFeed.hasNext)); setPendingFeed(null); }}>AIHOT 首页有更新，查看最新资讯 ↑</button> : null}
          {view === 'hot' ? <HotTopicsPanel refreshKey={refreshKey} materialIds={agentMaterialIds} bookmarkIds={bookmarkIds} onAddMaterial={addAihotToAgent} onToggleBookmark={bookmarks.toggle} onStateChange={setFeatureState} /> : null}
          {view === 'topics' ? <TopicsPanel refreshKey={refreshKey} materialIds={agentMaterialIds} bookmarkIds={bookmarkIds} onAddMaterial={addAihotToAgent} onToggleBookmark={bookmarks.toggle} onStateChange={setFeatureState} /> : null}
          {view === 'starred' ? <BookmarksPanel bookmarks={bookmarks.items} materialIds={agentMaterialIds} onAddMaterial={addAihotToAgent} onToggleBookmark={bookmarks.toggle} onImport={bookmarks.importBackup} /> : null}
          {view === 'leaderboard' ? <LeaderboardPanel refreshKey={refreshKey} onStateChange={setFeatureState} /> : null}
          {view === 'resets' ? <ResetsPanel refreshKey={refreshKey} onStateChange={setFeatureState} /> : null}

          {activeFeed ? (
            <section className="feed-filters" aria-label="资讯筛选">
              <div className="category-list" aria-label="资讯分类">
                {categories.map((item) => (
                  <button aria-pressed={category === item.id} className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)} type="button">
                    {item.shortLabel}
                  </button>
                ))}
              </div>
              <form className="search-bar" onSubmit={submitSearch}>
                <Search size={18} />
                <label htmlFor="feed-search">搜索 AI 动态</label>
                <input
                  id="feed-search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜索标题、摘要…"
                />
                <button type="submit">搜索</button>
              </form>
            </section>
          ) : null}

          {activeLoading && !activeSources && !activeRemoteFeature ? <StatusView title="正在加载信息源" detail="正在同步最新 AI 动态。" /> : null}
          {sourceLoading && activeSources ? <StatusView title="正在同步特定来源" detail="已先显示账号列表；最新发布会在读取器返回后更新。" /> : null}
          {!activeLoading && error && (activeFeed || view === 'daily') ? <StatusView title="信息源暂时不可用" detail={error} /> : null}
          {!activeLoading && sourceError && activeSources ? <StatusView title="特定来源部分不可用" detail={sourceError} /> : null}
          {!loading && !error && activeFeed && !items.length ? (
            <StatusView title="没有找到匹配动态" detail="换一个关键词或分类再试。" />
          ) : null}
          {!loading && !error && activeFeed && items.length ? (
            <div className="feed-area">
              <div className="feed-summary">
                <span>{query ? `“${query}” · ` : ''}{activeCategoryLabel}</span>
                <span>{hasNext ? `已载入 ${items.length} 条，还有更多` : `已载入 ${items.length} 条`}</span>
              </div>
              <FeedTimeline items={items} materialIds={agentMaterialIds} onAddMaterial={addAihotToAgent} bookmarkIds={bookmarkIds} onToggleBookmark={bookmarks.toggle} />
              {hasNext ? (
                <button className="load-more-button" type="button" onClick={loadMoreItems} disabled={loadingMore}>
                  {loadingMore ? '加载中' : `加载更多，已载入 ${items.length} 条`}
                </button>
              ) : null}
            </div>
          ) : null}
          {!loading && !error && view === 'daily' && daily ? <DailyPanel daily={daily} /> : null}
          {activeAgent ? (
            <AgentPanel
              busy={agentBusy}
              draft={agentDraft}
              error={agentError}
              history={agentHistory}
              job={agentJob}
              loading={agentLoading}
              logs={agentLogs}
              materials={agentMaterials}
              markdownFile={agentMarkdownFile}
              publishMode={agentPublishMode}
              revision={agentRevision}
              topic={agentTopic}
              onClearMaterials={clearAgentMaterialList}
              onConfirmDraft={() => agentJob && runAgentAction(() => confirmAgentDraft(agentJob.id))}
              onDraftChange={setAgentDraft}
              onMarkdownFileChange={setAgentMarkdownFile}
              onRegenerateDraft={async () => {
                const revisionNote = agentRevision.trim();
                if (agentJob && revisionNote) {
                  const success = await runAgentAction(() => regenerateAgentDraft(agentJob.id, revisionNote));
                  if (success) {
                    setAgentRevision('');
                  }
                }
              }}
              onRemoveMaterial={removeAgentMaterial}
              onResume={() => agentJob && runAgentAction(() => resumeAgentJob(agentJob.id))}
              onRestart={() => agentJob && runAgentAction(() => restartAgentJob(agentJob.id))}
              onRetry={() => agentJob && runAgentAction(() => retryAgentJob(agentJob.id))}
              onRevisionChange={setAgentRevision}
              onSaveDraft={() => agentJob && runAgentAction(() => saveAgentDraft(agentJob.id, agentDraft))}
              onPublishModeChange={setAgentPublishMode}
              onStop={stopCurrentAgentJob}
              onSubmit={submitAgentJob}
              onTopicChange={setAgentTopic}
              stopping={agentStopping}
            />
          ) : null}
          {!sourceError && activeSources ? (
            <SpecificSourcesPanel
              handles={sourceHandles}
              input={sourceInput}
              items={displayedSourceItems}
              materialIds={agentMaterialIds}
              onAddMaterial={addXToAgent}
              onInputChange={setSourceInput}
              onSubmit={submitSource}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}

function SidebarToggleButton({
  buttonRef,
  open,
  onToggle
}: {
  buttonRef: { current: HTMLButtonElement | null };
  open: boolean;
  onToggle: () => void;
}) {
  const label = open ? '收起侧栏' : '展开侧栏';
  const Icon = open ? PanelLeftClose : PanelLeftOpen;

  return (
    <button
      aria-controls="workspace-sidebar"
      aria-expanded={open}
      aria-label={label}
      className={`sidebar-toggle ${open ? 'sidebar-toggle-close' : 'sidebar-toggle-open'}`}
      ref={buttonRef}
      title={label}
      type="button"
      onClick={onToggle}
    >
      <Icon aria-hidden="true" size={16} />
    </button>
  );
}

const agentSteps: Array<{ id: AgentStepId; label: string }> = [
  { id: 'prepare_materials', label: '准备素材' },
  { id: 'generate_draft', label: '生成草稿' },
  { id: 'review_draft', label: '草稿确认' },
  { id: 'format_markdown', label: '格式排版' },
  { id: 'generate_cover', label: '生成封面' },
  { id: 'generate_illustrations', label: '文章配图' },
  { id: 'render_html', label: '转 HTML' },
  { id: 'publish_wechat_draft', label: '发微信草稿' },
  { id: 'completed', label: '完成' }
];

function AgentPanel({
  busy,
  draft,
  error,
  history,
  job,
  loading,
  logs,
  materials,
  markdownFile,
  publishMode,
  revision,
  topic,
  onClearMaterials,
  onConfirmDraft,
  onDraftChange,
  onMarkdownFileChange,
  onRegenerateDraft,
  onRemoveMaterial,
  onResume,
  onRestart,
  onRetry,
  onRevisionChange,
  onSaveDraft,
  onPublishModeChange,
  onStop,
  onSubmit,
  onTopicChange,
  stopping
}: {
  busy: boolean;
  draft: string;
  error: string | null;
  history: AgentHistoryEntry[];
  job: AgentJob | null;
  loading: boolean;
  logs: AgentLogEntry[];
  materials: AgentMaterial[];
  markdownFile: File | null;
  publishMode: AgentPublishMode;
  revision: string;
  topic: string;
  onClearMaterials: () => void;
  onConfirmDraft: () => void;
  onDraftChange: (value: string) => void;
  onMarkdownFileChange: (file: File | null) => void;
  onRegenerateDraft: () => void;
  onRemoveMaterial: (id: string) => void;
  onResume: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onRevisionChange: (value: string) => void;
  onSaveDraft: () => void;
  onPublishModeChange: (mode: AgentPublishMode) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTopicChange: (value: string) => void;
  stopping: boolean;
}) {
  const visibleAgentSteps =
    job?.sourceMode === 'markdown'
      ? agentSteps.map((step) => {
          if (step.id === 'prepare_materials') return { ...step, label: '读取文件' };
          if (step.id === 'generate_draft') return { ...step, label: '导入草稿' };
          return step;
        })
      : agentSteps;
  const currentStepIndex = job ? visibleAgentSteps.findIndex((step) => step.id === job.currentStep) : -1;
  const statusText = job ? getAgentStatusText(job.status) : '未开始';
  const statusClass = job ? `status-${job.status.replace('_', '-')}` : 'status-idle';
  const activeJobLocked = Boolean(job && job.status === 'running');

  return (
    <div className="agent-workbench">
      <section className="agent-cockpit-hero">
        <div className="agent-hero-copy">
          <h1>公众号自动发文AGENT</h1>
          <p>可输入主题、基于素材篮自动拟题，或导入本地 Markdown；草稿确认后继续排版、封面、配图、HTML 和微信草稿发布。</p>
        </div>
        <div className="agent-hero-status">
          <span className={`agent-status-pill ${statusClass}`}>{statusText}</span>
          <dl>
            <div>
              <dt>素材</dt>
              <dd>{materials.length} 条</dd>
            </div>
            <div>
              <dt>当前步骤</dt>
              <dd>{job ? visibleAgentSteps.find((step) => step.id === job.currentStep)?.label : '待启动'}</dd>
            </div>
          </dl>
        </div>
        <form className="agent-topic-form" onSubmit={onSubmit}>
          {publishMode === 'markdown' ? (
            <div className="agent-markdown-upload">
              <label htmlFor="agent-markdown-file">本地 Markdown 文件</label>
              <input
                id="agent-markdown-file"
                type="file"
                accept=".md,.markdown,text/markdown"
                onChange={(event) => onMarkdownFileChange(event.target.files?.[0] ?? null)}
              />
              <span>{markdownFile?.name ?? '请选择 Markdown 文件'}</span>
            </div>
          ) : (
            <>
              <label htmlFor="agent-topic">发文主题</label>
              <input
                id="agent-topic"
                value={topic}
                onChange={(event) => onTopicChange(event.target.value)}
                placeholder="输入公众号文章主题"
              />
            </>
          )}
          <div className="agent-mode-switch" aria-label="发文方式">
            <button
              aria-pressed={publishMode === 'topic'}
              className={publishMode === 'topic' ? 'active' : ''}
              type="button"
              onClick={() => onPublishModeChange('topic')}
              disabled={busy || loading || activeJobLocked}
            >
              基于主题发文
            </button>
            <button
              aria-pressed={publishMode === 'materials'}
              className={publishMode === 'materials' ? 'active' : ''}
              type="button"
              onClick={() => onPublishModeChange('materials')}
              disabled={busy || loading || activeJobLocked}
            >
              基于素材发文
            </button>
            <button
              aria-pressed={publishMode === 'markdown'}
              className={publishMode === 'markdown' ? 'active' : ''}
              type="button"
              onClick={() => onPublishModeChange('markdown')}
              disabled={busy || loading || activeJobLocked}
            >
              本地 Markdown
            </button>
          </div>
          <button className="agent-primary-button agent-start-button" type="submit" disabled={busy || loading || activeJobLocked}>
            开始发文
          </button>
        </form>
        {job?.status === 'running' ? (
          <button className="agent-stop-button agent-confirm-hero" type="button" onClick={onStop} disabled={stopping}>
            {stopping ? '正在停止' : '停止任务'}
          </button>
        ) : job?.status === 'stopped' ? (
          <button
            className="agent-primary-button agent-confirm-hero"
            type="button"
            onClick={onResume}
            disabled={busy || stopping}
          >
            继续任务
          </button>
        ) : job?.status === 'waiting_review' ? (
          <button className="agent-primary-button agent-confirm-hero" type="button" onClick={onConfirmDraft} disabled={busy}>
            确认继续
          </button>
        ) : null}
      </section>

      {error ? <StatusView title="Agent 操作失败" detail={error} /> : null}

      <section className="agent-cockpit-grid">
        <div className="agent-main">
          <section className="agent-section agent-timeline-card">
            <div>
              <p className="eyebrow">执行进度</p>
              <h2>{statusText}</h2>
            </div>
            {job?.paths.workDir ? <span className="agent-workdir">{job.paths.workDir}</span> : null}
            <ol className="agent-step-list">
              {visibleAgentSteps.map((step, index) => (
                <li
                  className={[
                    index < currentStepIndex || job?.status === 'completed' ? 'done' : '',
                    step.id === job?.currentStep ? 'active' : '',
                    step.id === job?.failedStep ? 'failed' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={step.id}
                >
                  <span>{index + 1}</span>
                  <strong>{step.label}</strong>
                </li>
              ))}
            </ol>
            {job?.status === 'failed' ? (
              <div className="agent-failure">
                <p>{job.error ?? '任务失败'}</p>
                <button type="button" onClick={onRetry} disabled={busy}>
                  从失败步骤继续
                </button>
                <button type="button" onClick={onRestart} disabled={busy}>
                  从头重跑
                </button>
              </div>
            ) : null}
          </section>

          {job?.status === 'waiting_review' ? (
            <section className="agent-section draft-review agent-editor-card">
              <div className="section-title">
                <div>
                  <p className="eyebrow">草稿确认</p>
                  <h2>等待草稿确认</h2>
                </div>
                <span className="agent-status-pill status-waiting-review">Markdown 草稿</span>
              </div>
              <div className="agent-editor-toolbar">
                <span>{job.paths.draftMarkdown ?? 'draft.md'}</span>
                <button className="agent-primary-button" type="button" onClick={onConfirmDraft} disabled={busy}>
                  确认继续
                </button>
              </div>
              <label htmlFor="agent-draft">草稿 Markdown</label>
              <textarea
                id="agent-draft"
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                rows={14}
              />
              <div className="draft-revision-panel">
                <label htmlFor="agent-revision">修改要求</label>
                <textarea
                  id="agent-revision"
                  value={revision}
                  onChange={(event) => onRevisionChange(event.target.value)}
                  placeholder="输入对当前草稿的修改要求，支持换行"
                  rows={4}
                />
              </div>
              <div className="draft-actions">
                <button type="button" onClick={onRegenerateDraft} disabled={busy || !revision.trim()}>
                  重新生成
                </button>
                <button type="button" onClick={onSaveDraft} disabled={busy}>
                  保存草稿
                </button>
                <button className="agent-primary-button" type="button" onClick={onConfirmDraft} disabled={busy}>
                  确认继续
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="agent-assist-rail">
          <section className="agent-section">
            <div className="section-title">
              <div>
                <p className="eyebrow">素材篮</p>
                <h2>{materials.length ? `${materials.length} 条素材` : '暂无素材'}</h2>
              </div>
              {materials.length ? (
                <button className="ghost-button" type="button" onClick={onClearMaterials}>
                  清空
                </button>
              ) : null}
            </div>
            <div className="agent-material-list">
              {materials.map((item) => (
                <article className="agent-material" key={item.id}>
                  <div>
                    <span className={`agent-source-chip source-${item.sourceType}`}>{item.sourceType === 'aihot' ? 'AI HOT' : 'X'}</span>
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                  </div>
                  <button aria-label={`移除素材：${item.title}`} type="button" onClick={() => onRemoveMaterial(item.id)}>
                    <X size={15} />
                  </button>
                </article>
              ))}
              {!materials.length ? <p className="agent-empty">可以只输入主题，也可以从 AI HOT 或特定来源加入素材。</p> : null}
            </div>
          </section>

          <section className="agent-section agent-console">
            <div className="section-title">
              <div>
                <p className="eyebrow">运行日志</p>
                <h2>Console</h2>
              </div>
              <span>{logs.length} 条</span>
            </div>
            <div className="agent-log-list">
              {logs.map((entry) => (
                <p className={entry.level} key={`${entry.at}-${entry.step}-${entry.message}`}>
                  <span>{entry.step}</span>
                  {entry.message}
                </p>
              ))}
              {!logs.length ? <p>暂无日志</p> : null}
            </div>
          </section>

          <section className="agent-section agent-history-card">
            <div className="section-title">
              <div>
                <p className="eyebrow">成功记录</p>
                <h2>历史</h2>
              </div>
              <span>{history.length} 条</span>
            </div>
            <div className="agent-history-list">
              {history.map((entry) => (
                <article key={entry.id}>
                  <strong>{entry.topic}</strong>
                  <span>{entry.workDir}</span>
                </article>
              ))}
              {!history.length ? <p>暂无成功记录</p> : null}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function getAgentStatusText(status: AgentJob['status']): string {
  if (status === 'waiting_review') return '等待草稿确认';
  if (status === 'running') return '执行中';
  if (status === 'stopped') return '已停止';
  if (status === 'failed') return '执行失败';
  return '已完成';
}

function SpecificSourcesPanel({
  handles,
  input,
  items,
  materialIds,
  onAddMaterial,
  onInputChange,
  onSubmit
}: {
  handles: string[];
  input: string;
  items: XSourceItem[];
  materialIds: Set<string>;
  onAddMaterial: (item: XSourceItem) => void;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [player, setPlayer] = useState<{ title: string; embedUrl: string | null; sourceUrl: string; videoUrl?: string | null; posterUrl?: string | null } | null>(null);
  const [previewImage, setPreviewImage] = useState<{ title: string; url: string } | null>(null);

  return (
    <div className="sources-panel">
      <section className="control-panel source-import-panel">
        <div>
          <p className="eyebrow">X 来源</p>
          <h2>导入新的账号</h2>
        </div>
        <form className="search-bar" onSubmit={onSubmit}>
          <Plus size={18} />
          <label htmlFor="source-import">X 账号链接或 handle</label>
          <input
            id="source-import"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder="https://x.com/OpenAI 或 @OpenAI"
          />
          <button type="submit">导入</button>
        </form>
      </section>

      <div className="section-title">
        <div>
          <p className="eyebrow">最新发布</p>
          <h2>特定来源</h2>
        </div>
        <span>{handles.length} 个账号</span>
      </div>

      <div className="source-list" data-testid="specific-sources-list">
        {items.map((item) => (
          <article className="source-card source-row" data-testid="specific-source-row" key={item.handle}>
            <div className="source-card-head">
              <div>
                <strong>{item.displayName ?? item.handle}</strong>
                <a href={item.profileUrl} target="_blank" rel="noreferrer">
                  @{item.handle}
                </a>
              </div>
              <a className="source-open" href={item.latestPost?.url ?? item.profileUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${item.handle}`}>
                <ExternalLink size={17} />
              </a>
            </div>
            {item.latestPost ? (
              <>
                <p className="source-post">{item.latestPost.translatedText || item.latestPost.text}</p>
                {item.latestPost.translatedText && item.latestPost.translatedText !== item.latestPost.text ? (
                  <p className="source-original">{item.latestPost.text}</p>
                ) : null}
                {item.latestPost.media?.length ? (
                  <div className={`source-media-grid source-media-count-${Math.min(item.latestPost.media.length, 4)}`}>
                    {item.latestPost.media.slice(0, 4).map((entry) => {
                      const preview = (
                        <>
                          <img alt={`${item.handle} 发布媒体`} referrerPolicy="no-referrer" src={entry.url} loading="lazy" />
                          {entry.type === 'video' ? (
                            <>
                              <span className="source-media-badge">视频</span>
                              <span className="source-media-play" aria-hidden="true">
                                <PlayCircle size={40} strokeWidth={1.8} />
                              </span>
                            </>
                          ) : null}
                        </>
                      );

                      if (entry.type === 'video') {
                        return (
                          <button
                            aria-label={`播放视频：${item.handle}`}
                            className="source-media-cell source-media-button"
                            key={`${entry.url}-${entry.type}`}
                            onClick={() =>
                              setPlayer({
                                title: item.latestPost?.translatedText || item.latestPost?.text || item.handle,
                                embedUrl: entry.embedUrl ?? null,
                                videoUrl: entry.videoUrl ?? null,
                                posterUrl: entry.url,
                                sourceUrl: item.latestPost?.url ?? item.profileUrl
                              })
                            }
                            type="button"
                          >
                            {preview}
                          </button>
                        );
                      }

                      return (
                        <button
                          aria-label={`查看图片：${item.handle}`}
                          className="source-media-cell source-media-button"
                          key={`${entry.url}-${entry.type}`}
                          onClick={() => setPreviewImage({ title: item.handle, url: entry.url })}
                          type="button"
                        >
                          {preview}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="source-card-foot">
                  <span>{formatBeijingTime(item.latestPost.createdAt)}</span>
                  <a href={item.latestPost.url} target="_blank" rel="noreferrer">
                    查看原文
                  </a>
                  <button
                    aria-label={`${materialIds.has(`x:${item.handle.toLowerCase()}`) ? '已加入素材' : '加入素材'}：${item.displayName ?? item.handle}`}
                    className="material-action"
                    disabled={materialIds.has(`x:${item.handle.toLowerCase()}`)}
                    onClick={() => onAddMaterial(item)}
                    type="button"
                  >
                    {materialIds.has(`x:${item.handle.toLowerCase()}`) ? <Check size={15} /> : <Plus size={15} />}
                    {materialIds.has(`x:${item.handle.toLowerCase()}`) ? '已加入' : '加入素材'}
                  </button>
                </div>
              </>
            ) : (
              <p className="source-empty">{item.error ?? '暂无可展示的最新发布'}</p>
            )}
          </article>
        ))}
      </div>
      {player ? (
        <div className="player-backdrop" role="presentation">
          <div aria-label={player.title} aria-modal="true" className="player-dialog" role="dialog">
            <div className="player-head">
              <strong>{player.title}</strong>
              <button type="button" onClick={() => setPlayer(null)}>
                <X size={16} />
                关闭
              </button>
            </div>
            {player.videoUrl ? (
              <SourceVideoPlayer posterUrl={player.posterUrl ?? null} title={player.title} videoUrl={player.videoUrl} />
            ) : (
              <div className="source-video-fallback">
                {player.posterUrl ? <img alt={player.title} referrerPolicy="no-referrer" src={player.posterUrl} /> : null}
                <p>当前读取器只提供视频缩略图，未返回可内嵌播放地址。</p>
              </div>
            )}
            <a className="player-source" href={player.sourceUrl} rel="noreferrer" target="_blank">
              打开原文播放
            </a>
          </div>
        </div>
      ) : null}
      {previewImage ? (
        <div className="player-backdrop" role="presentation">
          <div aria-label={`${previewImage.title} 图片预览`} aria-modal="true" className="player-dialog image-preview-dialog" role="dialog">
            <div className="player-head">
              <strong>{previewImage.title}</strong>
              <button aria-label="关闭图片预览" type="button" onClick={() => setPreviewImage(null)}>
                <X size={16} />
                关闭
              </button>
            </div>
            <img alt={`${previewImage.title} 图片预览`} className="image-preview-frame" referrerPolicy="no-referrer" src={previewImage.url} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SourceVideoPlayer({ posterUrl, title, videoUrl }: { posterUrl: string | null; title: string; videoUrl: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoUrl;
      return;
    }

    let disposed = false;
    let hls: { loadSource: (source: string) => void; attachMedia: (media: HTMLMediaElement) => void; destroy: () => void } | null = null;

    import('hls.js').then(({ default: Hls }) => {
      if (disposed || !video) {
        return;
      }

      if (!Hls.isSupported()) {
        video.src = videoUrl;
        return;
      }

      hls = new Hls();
      hls.loadSource(videoUrl);
      hls.attachMedia(video);
    });

    return () => {
      disposed = true;
      hls?.destroy();
    };
  }, [videoUrl]);

  return (
    <div className="player-frame source-video-stage">
      <video
        ref={videoRef}
        aria-label={title}
        className={`player-video ${loaded ? 'loaded' : ''}`}
        controls
        onCanPlay={() => setLoaded(true)}
        onLoadedData={() => setLoaded(true)}
        playsInline
        poster={posterUrl ?? undefined}
      />
      {posterUrl && !loaded ? (
        <img alt={`${title} 视频封面`} className="source-video-poster" referrerPolicy="no-referrer" src={posterUrl} />
      ) : null}
    </div>
  );
}


function DailyPanel({ daily }: { daily: DailyResponse }) {
  return (
    <div className="daily-panel">
      <section className="daily-lead">
        <p className="eyebrow">日报 · {daily.date}</p>
        <h2>{daily.lead?.title ?? '今日 AI HOT'}</h2>
        {daily.lead?.leadParagraph ? <p>{daily.lead.leadParagraph}</p> : null}
      </section>
      {daily.sections.map((section) => (
        <section className="daily-section" key={section.label}>
          <h3>{section.label}</h3>
          {section.items.map((item) => (
            <article key={`${section.label}-${item.title}`}>
              <a href={item.sourceUrl ?? '#'} target="_blank" rel="noreferrer">
                {item.title}
              </a>
              <span>{item.sourceName}</span>
              {item.summary ? <p>{item.summary}</p> : null}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
