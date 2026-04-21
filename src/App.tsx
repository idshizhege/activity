import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Copy,
  Eraser,
  Gem,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Pencil,
  PartyPopper,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { adminEmail, isSupabaseConfigured, supabase } from "./lib/supabase";

type AttendanceStatus = "yes" | "maybe" | "no";

type Participant = {
  id: number;
  viewerToken: string;
  name: string;
  status: AttendanceStatus;
  eta: string;
  leaveAt: string;
  obstacle: string;
  note: string;
  updatedAt: string;
};

type EventInfo = {
  title: string;
  category: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  updatedAt: string;
};

type DraftParticipant = {
  name: string;
  status: AttendanceStatus;
  eta: string;
  leaveAt: string;
  obstacle: string;
  note: string;
};

type ParticipantRow = {
  id: number;
  viewer_token: string;
  name: string;
  status: AttendanceStatus;
  eta: string | null;
  leave_at: string | null;
  obstacle: string | null;
  note: string | null;
  updated_at: string;
};

type EventInfoRow = {
  id: number;
  title: string;
  category: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  updated_at: string;
};

const TOKEN_KEY = "activity-planner-supabase-token";
const POLL_INTERVAL = 12000;
const ARCHIVED_PARTICIPANT_PREFIX = "__archived__:";

const emptyDraft: DraftParticipant = {
  name: "",
  status: "yes",
  eta: "",
  leaveAt: "",
  obstacle: "",
  note: "",
};

const defaultEventInfo: EventInfo = {
  title: "活动加载中",
  category: "",
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  description: "正在同步活动信息，请稍等。",
  updatedAt: "",
};

const statusMeta: Record<
  AttendanceStatus,
  {
    label: string;
    shortLabel: string;
    className: string;
    softClassName: string;
    icon: typeof CheckCircle2;
  }
> = {
  yes: {
    label: "确定参加",
    shortLabel: "能来",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softClassName: "bg-emerald-500",
    icon: CheckCircle2,
  },
  maybe: {
    label: "待定",
    shortLabel: "待定",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    softClassName: "bg-amber-500",
    icon: AlertCircle,
  },
  no: {
    label: "来不了",
    shortLabel: "缺席",
    className: "border-rose-200 bg-rose-50 text-rose-700",
    softClassName: "bg-rose-500",
    icon: XCircle,
  },
};

function generateViewerToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getViewerToken() {
  if (typeof window === "undefined") return "";
  const saved = window.localStorage.getItem(TOKEN_KEY);
  if (saved) return saved;
  const created = generateViewerToken();
  window.localStorage.setItem(TOKEN_KEY, created);
  return created;
}

function isAdminMode() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("mode") === "admin";
}

function getPublicUrl() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
}

function getAdminUrl() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}?mode=admin`;
}

function formatRange(startTime: string, endTime: string) {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  return startTime || endTime || "时间待定";
}

function formatRelativeTime(isoTime: string) {
  if (!isoTime) return "刚刚";
  const timestamp = new Date(isoTime).getTime();
  if (Number.isNaN(timestamp)) return "刚刚";
  const diff = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function isArchivedParticipantName(name: string) {
  return name.startsWith(ARCHIVED_PARTICIPANT_PREFIX);
}

function buildArchivedParticipantName(participantId: number) {
  return `${ARCHIVED_PARTICIPANT_PREFIX}${participantId}`;
}

function buildShareText(eventInfo: EventInfo, participants: Participant[]) {
  const yes = participants.filter((item) => item.status === "yes");
  const maybe = participants.filter((item) => item.status === "maybe");
  const no = participants.filter((item) => item.status === "no");
  const blockers = participants.filter((item) => item.obstacle.trim());

  return [
    `【${eventInfo.title}】`,
    `时间：${eventInfo.date} ${formatRange(eventInfo.startTime, eventInfo.endTime)}`,
    `地点：${eventInfo.location || "待定"}`,
    `活动：${eventInfo.category || "待定"}`,
    "",
    `能来（${yes.length}）：${yes.map((item) => `${item.name}${item.eta ? ` ${item.eta}到` : ""}`).join("、") || "暂无"}`,
    `待定（${maybe.length}）：${maybe.map((item) => item.name).join("、") || "暂无"}`,
    `来不了（${no.length}）：${no.map((item) => item.name).join("、") || "暂无"}`,
    "",
    "待协调：",
    ...(blockers.length ? blockers.map((item) => `- ${item.name}：${item.obstacle}`) : ["- 暂无"]),
  ].join("\n");
}

function mapParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    viewerToken: row.viewer_token,
    name: row.name,
    status: row.status,
    eta: row.eta || "",
    leaveAt: row.leave_at || "",
    obstacle: row.obstacle || "",
    note: row.note || "",
    updatedAt: row.updated_at,
  };
}

function mapEventInfo(row: EventInfoRow | null): EventInfo {
  if (!row) return defaultEventInfo;
  return {
    title: row.title,
    category: row.category || "",
    date: row.date || "",
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    location: row.location || "",
    description: row.description || "",
    updatedAt: row.updated_at,
  };
}

async function loadEventInfo() {
  if (!supabase) return defaultEventInfo;
  const { data, error } = await supabase
    .from("event_info")
    .select("id,title,category,date,start_time,end_time,location,description,updated_at")
    .eq("id", 1)
    .maybeSingle<EventInfoRow>();

  if (error) throw error;
  return mapEventInfo(data);
}

async function loadParticipants() {
  if (!supabase) return [] as Participant[];
  const { data, error } = await supabase
    .from("participants")
    .select("id,viewer_token,name,status,eta,leave_at,obstacle,note,updated_at")
    .order("updated_at", { ascending: false })
    .returns<ParticipantRow[]>();

  if (error) throw error;
  return (data || []).filter((row) => !isArchivedParticipantName(row.name)).map(mapParticipant);
}

async function loadMySubmission(viewerToken: string) {
  if (!supabase || !viewerToken) return null;
  const { data, error } = await supabase
    .from("participants")
    .select("id,viewer_token,name,status,eta,leave_at,obstacle,note,updated_at")
    .eq("viewer_token", viewerToken)
    .maybeSingle<ParticipantRow>();

  if (error) throw error;
  if (!data || isArchivedParticipantName(data.name)) return null;
  return mapParticipant(data);
}

async function saveSubmission(viewerToken: string, draft: DraftParticipant) {
  if (!supabase) {
    throw new Error("Supabase 尚未配置");
  }

  const payload = {
    viewer_token: viewerToken,
    name: draft.name.trim(),
    status: draft.status,
    eta: draft.eta.trim(),
    leave_at: draft.leaveAt.trim(),
    obstacle: draft.obstacle.trim(),
    note: draft.note.trim(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("participants").upsert(payload, {
    onConflict: "viewer_token",
  });

  if (error) throw error;
}

async function saveEventInfo(eventInfo: EventInfo) {
  if (!supabase) {
    throw new Error("Supabase 尚未配置");
  }

  const payload = {
    id: 1,
    title: eventInfo.title.trim(),
    category: eventInfo.category.trim(),
    date: eventInfo.date.trim(),
    start_time: eventInfo.startTime.trim(),
    end_time: eventInfo.endTime.trim(),
    location: eventInfo.location.trim(),
    description: eventInfo.description.trim(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("event_info")
    .update(payload)
    .eq("id", 1)
    .select("id")
    .maybeSingle<{ id: number }>();

  if (error) throw error;

  if (!data) {
    throw new Error("保存失败：没有找到活动主记录，请在 Supabase 里确认 event_info 表中 id=1 的数据仍然存在。");
  }
}

function participantToDraft(participant: Participant): DraftParticipant {
  return {
    name: participant.name,
    status: participant.status,
    eta: participant.eta,
    leaveAt: participant.leaveAt,
    obstacle: participant.obstacle,
    note: participant.note,
  };
}

async function updateParticipantRecord(participantId: number, draft: DraftParticipant) {
  if (!supabase) {
    throw new Error("Supabase 尚未配置");
  }

  const payload = {
    name: draft.name.trim(),
    status: draft.status,
    eta: draft.eta.trim(),
    leave_at: draft.leaveAt.trim(),
    obstacle: draft.obstacle.trim(),
    note: draft.note.trim(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("participants")
    .update(payload)
    .eq("id", participantId)
    .select("id")
    .maybeSingle<{ id: number }>();

  if (error) throw error;

  if (!data) {
    throw new Error("保存失败：没有找到这条报名记录。");
  }
}

async function deleteParticipantRecord(participantId: number) {
  if (!supabase) {
    throw new Error("Supabase 尚未配置");
  }

  const payload = {
    name: buildArchivedParticipantName(participantId),
    status: "no" as AttendanceStatus,
    eta: "",
    leave_at: "",
    obstacle: "",
    note: "",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("participants")
    .update(payload)
    .eq("id", participantId)
    .select("id")
    .maybeSingle<{ id: number }>();

  if (error) throw error;

  if (!data) {
    throw new Error("删除失败：没有找到这条报名记录。");
  }
}

async function clearAllParticipants() {
  if (!supabase) {
    throw new Error("Supabase 尚未配置");
  }

  const { error } = await supabase
    .from("participants")
    .update({
      name: `${ARCHIVED_PARTICIPANT_PREFIX}${Date.now()}`,
      status: "no",
      eta: "",
      leave_at: "",
      obstacle: "",
      note: "",
      updated_at: new Date().toISOString(),
    })
    .not("name", "like", `${ARCHIVED_PARTICIPANT_PREFIX}%`);

  if (error) throw error;
}

function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-10">
      <div className="w-full rounded-3xl border border-amber-200 bg-white/95 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] md:p-8">
        <div className="flex items-center gap-3 text-amber-700">
          <AlertCircle className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">还差一步：先配置 Supabase</h1>
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          这个版本已经改成适合 `GitHub Pages` 的纯前端方案，但要先在环境变量里填写
          `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，页面才能真正读写报名数据。
        </p>
        <div className="mt-5 rounded-2xl bg-slate-950 p-4 text-sm leading-7 text-slate-100">
          <div>1. 复制 `web/.env.example` 为 `web/.env`</div>
          <div>2. 填入你的 Supabase 项目地址和匿名 key</div>
          <div>3. 如需管理员编辑，再填 `VITE_ADMIN_EMAIL`</div>
          <div>4. 重新执行 `npm run build` 或 `npm run dev`</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [adminMode] = useState(isAdminMode);
  const [viewerToken] = useState(getViewerToken);
  const [session, setSession] = useState<Session | null>(null);
  const [eventInfo, setEventInfo] = useState<EventInfo>(defaultEventInfo);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [draft, setDraft] = useState<DraftParticipant>(emptyDraft);
  const [adminDraft, setAdminDraft] = useState<EventInfo>(defaultEventInfo);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);
  const [editingParticipantId, setEditingParticipantId] = useState<number | null>(null);
  const [adminParticipantDraft, setAdminParticipantDraft] = useState<DraftParticipant>(emptyDraft);
  const [adminParticipantSaving, setAdminParticipantSaving] = useState<number | "all" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [adminLogin, setAdminLogin] = useState({ email: adminEmail, password: "" });

  const mySubmission = useMemo(
    () => participants.find((item) => item.viewerToken === viewerToken) || null,
    [participants, viewerToken],
  );

  const isAdminAuthorized = useMemo(() => {
    const email = session?.user?.email?.toLowerCase() || "";
    if (!email || !adminEmail) return false;
    return email === adminEmail.toLowerCase();
  }, [session]);

  const stats = useMemo(() => {
    const yes = participants.filter((item) => item.status === "yes");
    const maybe = participants.filter((item) => item.status === "maybe");
    const no = participants.filter((item) => item.status === "no");
    return {
      yes,
      maybe,
      no,
      blockers: participants.filter((item) => item.obstacle.trim()),
    };
  }, [participants]);

  const highlightCards = [
    {
      title: "先把人聚齐",
      description: "时间、地点、节奏和玩法一次讲清楚，群里不用来回翻消息，也方便大家快速决定来不来。",
    },
    {
      title: "安排更从容",
      description: "谁能来、谁待定、谁有困难实时可见，方便临时改地点、调时间或顺手拼车约饭。",
    },
    {
      title: "氛围更到位",
      description: "不是冷冰冰的报名表，而是一页有气氛、有画面、有期待感的活动邀请。",
    },
  ];

  const timelineItems = [
    { label: "活动日期", value: eventInfo.date || "待定" },
    { label: "开始时间", value: eventInfo.startTime || "待定" },
    { label: "结束时间", value: eventInfo.endTime || "待定" },
    { label: "集合地点", value: eventInfo.location || "待定" },
  ];

  const galleryImages = [
    {
      title: "傍晚集合，状态刚好",
      description: "适合下班后直接过来，不必太赶，能吃饭、能聊天，也能把这段时间的近况一次补齐。",
      image:
        "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1400&q=80",
    },
    {
      title: "吃饭聊天，不只打卡",
      description: "这次重点不是走流程，而是把熟人重新聚起来，边吃边聊，节奏轻松一点，体验也更自然。",
      image:
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1400&q=80",
    },
    {
      title: "这页以后还能继续用",
      description: "下次不管是端午、中秋、生日、聚餐还是团建，后台改一下活动信息，这个页面就会自动同步成新活动。",
      image:
        "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=1400&q=80",
    },
  ];

  const primaryStats = [
    { label: "确定参加", value: stats.yes.length, accent: "from-emerald-400/30 to-emerald-500/10" },
    { label: "待定观察", value: stats.maybe.length, accent: "from-amber-400/30 to-amber-500/10" },
    { label: "暂时缺席", value: stats.no.length, accent: "from-rose-400/30 to-rose-500/10" },
    { label: "总报名数", value: participants.length, accent: "from-cyan-400/30 to-cyan-500/10" },
  ];

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (mySubmission) {
      setDraft({
        name: mySubmission.name,
        status: mySubmission.status,
        eta: mySubmission.eta,
        leaveAt: mySubmission.leaveAt,
        obstacle: mySubmission.obstacle,
        note: mySubmission.note,
      });
      return;
    }

    setDraft((current) => (current.name ? current : emptyDraft));
  }, [mySubmission]);

  const refreshActivity = async (silent = false) => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [nextEventInfo, nextParticipants, nextMine] = await Promise.all([
        loadEventInfo(),
        loadParticipants(),
        loadMySubmission(viewerToken),
      ]);

      setEventInfo(nextEventInfo);
      setAdminDraft(nextEventInfo);
      if (nextMine) {
        const merged = nextParticipants.some((item) => item.viewerToken === viewerToken)
          ? nextParticipants
          : [nextMine, ...nextParticipants];
        setParticipants(merged);
      } else {
        setParticipants(nextParticipants);
      }
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "同步失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshActivity();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const timer = window.setInterval(() => {
      void refreshActivity(true);
    }, POLL_INTERVAL);
    return () => window.clearInterval(timer);
  }, [viewerToken]);

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      setError("先填写你的名字，大家才知道是谁。");
      return;
    }

    setSubmitting(true);
    try {
      await saveSubmission(viewerToken, draft);
      await refreshActivity(true);
      setError("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminSignIn = async () => {
    if (!supabase) return;
    if (!adminLogin.email.trim() || !adminLogin.password.trim()) {
      setError("管理员邮箱和密码都要填写。");
      return;
    }

    setSubmitting(true);
    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: adminLogin.email.trim(),
        password: adminLogin.password,
      });
      if (loginError) throw loginError;
      setError("");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const handleAdminSave = async () => {
    if (!isAdminAuthorized) {
      setError("请先使用管理员账号登录。");
      return;
    }

    setAdminSaving(true);
    try {
      await saveEventInfo(adminDraft);
      await refreshActivity(true);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setAdminSaving(false);
    }
  };

  const handleCopyShareText = async () => {
    try {
      await navigator.clipboard.writeText(buildShareText(eventInfo, participants));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("复制失败，请手动长按复制。");
    }
  };

  const handleEditParticipant = (participant: Participant) => {
    setEditingParticipantId(participant.id);
    setAdminParticipantDraft(participantToDraft(participant));
    setError("");
  };

  const handleCancelParticipantEdit = () => {
    setEditingParticipantId(null);
    setAdminParticipantDraft(emptyDraft);
  };

  const handleAdminParticipantSave = async (participantId: number) => {
    if (!adminParticipantDraft.name.trim()) {
      setError("报名人姓名不能为空。");
      return;
    }

    setAdminParticipantSaving(participantId);
    try {
      await updateParticipantRecord(participantId, adminParticipantDraft);
      await refreshActivity(true);
      setEditingParticipantId(null);
      setAdminParticipantDraft(emptyDraft);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存报名记录失败");
    } finally {
      setAdminParticipantSaving(null);
    }
  };

  const handleDeleteParticipant = async (participant: Participant) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确定删除 ${participant.name} 这条报名记录吗？`);
      if (!confirmed) return;
    }

    setAdminParticipantSaving(participant.id);
    try {
      await deleteParticipantRecord(participant.id);
      await refreshActivity(true);
      if (editingParticipantId === participant.id) {
        setEditingParticipantId(null);
        setAdminParticipantDraft(emptyDraft);
      }
      setError("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除报名记录失败");
    } finally {
      setAdminParticipantSaving(null);
    }
  };

  const handleClearAllParticipants = async () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("确定清空当前所有报名记录吗？这个操作通常用于切换到下一次新活动。");
      if (!confirmed) return;
    }

    setAdminParticipantSaving("all");
    try {
      await clearAllParticipants();
      await refreshActivity(true);
      setEditingParticipantId(null);
      setAdminParticipantDraft(emptyDraft);
      setDraft(emptyDraft);
      setError("");
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "清空报名记录失败");
    } finally {
      setAdminParticipantSaving(null);
    }
  };

  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_50%,#f8fafc_100%)] px-4">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-lg shadow-slate-200/60">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在同步活动数据…
        </div>
      </div>
    );
  }

  if (adminMode) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_50%,#f8fafc_100%)] px-4 py-6 text-slate-900 md:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  管理编辑页
                </div>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">活动信息管理</h1>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  公开报名链接：
                  <a className="font-medium text-indigo-600 underline-offset-2 hover:underline" href={getPublicUrl()}>
                    {getPublicUrl()}
                  </a>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 hover:border-slate-300 hover:text-slate-700"
                  onClick={() => void refreshActivity(true)}
                  type="button"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  刷新
                </button>
                {session ? (
                  <button
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 hover:border-slate-300 hover:text-slate-700"
                    onClick={() => void handleAdminLogout()}
                    type="button"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    退出登录
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {!isAdminAuthorized ? (
            <div className="space-y-6">
              <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-6">
                  <div className="flex items-center gap-3">
                    <LockKeyhole className="h-5 w-5 text-indigo-500" />
                    <h2 className="text-lg font-semibold">管理员登录</h2>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    用管理员账号登录后，才能修改活动标题、时间、地点和说明。
                  </p>
                  {!adminEmail ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      还没配置管理员邮箱，所以我先把保存权限锁住了。你把要用的管理员邮箱发我，我马上替你配上并重新部署。
                    </div>
                  ) : null}
                  <div className="mt-5 space-y-4">
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">管理员邮箱</span>
                      <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                        onChange={(event) => setAdminLogin((current) => ({ ...current, email: event.target.value }))}
                        placeholder="admin@example.com"
                        type="email"
                        value={adminLogin.email}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">密码</span>
                      <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                        onChange={(event) => setAdminLogin((current) => ({ ...current, password: event.target.value }))}
                        placeholder="输入 Supabase Auth 密码"
                        type="password"
                        value={adminLogin.password}
                      />
                    </label>
                    <button
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={submitting}
                      onClick={() => void handleAdminSignIn()}
                      type="button"
                    >
                      {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      登录后编辑
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl border border-indigo-100 bg-indigo-50/80 p-5 md:p-6">
                  <h2 className="text-lg font-semibold text-slate-900">这个管理模式怎么分享</h2>
                  <div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
                    <p>公开报名页直接发：`{getPublicUrl()}`</p>
                    <p>管理员页面自己留着：`{getAdminUrl()}`</p>
                    <p>活动信息修改仍然需要管理员登录。</p>
                    <p>报名记录管理已经开放，下面就能直接编辑、删除、清空。</p>
                  </div>
                </div>
              </section>

              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-6">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-indigo-500" />
                    <h2 className="text-lg font-semibold">当前汇总</h2>
                  </div>
                  <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                      <div className="text-xs">能来</div>
                      <div className="mt-2 text-2xl font-semibold">{stats.yes.length}</div>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-700">
                      <div className="text-xs">待定</div>
                      <div className="mt-2 text-2xl font-semibold">{stats.maybe.length}</div>
                    </div>
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
                      <div className="text-xs">来不了</div>
                      <div className="mt-2 text-2xl font-semibold">{stats.no.length}</div>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">报名明细</h2>
                      <p className="mt-1 text-sm text-slate-500">这里可以直接改某个人的报名内容，或者在切换到新活动时一键清空旧报名。</p>
                    </div>
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={adminParticipantSaving === "all" || !participants.length}
                      onClick={() => void handleClearAllParticipants()}
                      type="button"
                    >
                      {adminParticipantSaving === "all" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
                      开始新活动：清空全部报名
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {participants.length ? (
                      participants.map((item) => {
                        const meta = statusMeta[item.status];
                        const Icon = meta.icon;
                        const isEditing = editingParticipantId === item.id;
                        const isBusy = adminParticipantSaving === item.id;

                        return (
                          <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4" key={item.id}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-base font-medium text-slate-900">{item.name}</span>
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>
                                    <Icon className="h-3.5 w-3.5" />
                                    {meta.shortLabel}
                                  </span>
                                </div>
                                <div className="mt-2 text-xs text-slate-500">更新于 {formatRelativeTime(item.updatedAt)}</div>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <button
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isBusy}
                                  onClick={() => handleEditParticipant(item)}
                                  type="button"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  编辑
                                </button>
                                <button
                                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isBusy}
                                  onClick={() => void handleDeleteParticipant(item)}
                                  type="button"
                                >
                                  {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                  删除
                                </button>
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="mt-4 space-y-4 rounded-2xl border border-indigo-100 bg-white p-4">
                                <div className="grid gap-3 sm:grid-cols-3">
                                  {(["yes", "maybe", "no"] as AttendanceStatus[]).map((status) => {
                                    const optionMeta = statusMeta[status];
                                    const OptionIcon = optionMeta.icon;
                                    const active = adminParticipantDraft.status === status;

                                    return (
                                      <button
                                        className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${active ? `${optionMeta.className} shadow-sm` : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
                                        key={status}
                                        onClick={() => setAdminParticipantDraft((current) => ({ ...current, status }))}
                                        type="button"
                                      >
                                        <span className="inline-flex items-center gap-2 font-medium">
                                          <OptionIcon className="h-4 w-4" />
                                          {optionMeta.label}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                  <label className="block space-y-2 sm:col-span-2">
                                    <span className="text-sm font-medium text-slate-700">名字</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, name: event.target.value }))} value={adminParticipantDraft.name} />
                                  </label>
                                  <label className="block space-y-2">
                                    <span className="text-sm font-medium text-slate-700">预计到达</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, eta: event.target.value }))} value={adminParticipantDraft.eta} />
                                  </label>
                                  <label className="block space-y-2">
                                    <span className="text-sm font-medium text-slate-700">预计离开</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, leaveAt: event.target.value }))} value={adminParticipantDraft.leaveAt} />
                                  </label>
                                  <label className="block space-y-2 sm:col-span-2">
                                    <span className="text-sm font-medium text-slate-700">困难</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, obstacle: event.target.value }))} value={adminParticipantDraft.obstacle} />
                                  </label>
                                  <label className="block space-y-2 sm:col-span-2">
                                    <span className="text-sm font-medium text-slate-700">备注</span>
                                    <textarea className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, note: event.target.value }))} value={adminParticipantDraft.note} />
                                  </label>
                                </div>

                                <div className="flex flex-wrap gap-3">
                                  <button
                                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={isBusy}
                                    onClick={() => void handleAdminParticipantSave(item.id)}
                                    type="button"
                                  >
                                    {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                    保存这条报名
                                  </button>
                                  <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300" onClick={() => handleCancelParticipantEdit()} type="button">
                                    取消编辑
                                  </button>
                                </div>
                              </div>
                            ) : (item.eta || item.leaveAt || item.obstacle || item.note) ? (
                              <div className="mt-3 space-y-2 text-sm text-slate-600">
                                {item.eta ? <p>预计到达：{item.eta}</p> : null}
                                {item.leaveAt ? <p>预计离开：{item.leaveAt}</p> : null}
                                {item.obstacle ? <p>困难：{item.obstacle}</p> : null}
                                {item.note ? <p>备注：{item.note}</p> : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                        还没有人报名，先从公开页提交第一条吧。
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-6">
                <div className="flex items-center gap-3">
                  <PartyPopper className="h-5 w-5 text-indigo-500" />
                  <h2 className="text-lg font-semibold">编辑活动信息</h2>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2 md:col-span-2">
                    <span className="text-sm font-medium text-slate-700">活动标题</span>
                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={adminDraft.title} onChange={(event) => setAdminDraft((current) => ({ ...current, title: event.target.value }))} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-700">活动类型</span>
                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={adminDraft.category} onChange={(event) => setAdminDraft((current) => ({ ...current, category: event.target.value }))} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-700">日期</span>
                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={adminDraft.date} onChange={(event) => setAdminDraft((current) => ({ ...current, date: event.target.value }))} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-700">开始时间</span>
                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={adminDraft.startTime} onChange={(event) => setAdminDraft((current) => ({ ...current, startTime: event.target.value }))} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-700">结束时间</span>
                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={adminDraft.endTime} onChange={(event) => setAdminDraft((current) => ({ ...current, endTime: event.target.value }))} />
                  </label>
                  <label className="block space-y-2 md:col-span-2">
                    <span className="text-sm font-medium text-slate-700">地点</span>
                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={adminDraft.location} onChange={(event) => setAdminDraft((current) => ({ ...current, location: event.target.value }))} />
                  </label>
                  <label className="block space-y-2 md:col-span-2">
                    <span className="text-sm font-medium text-slate-700">活动说明</span>
                    <textarea className="min-h-36 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={adminDraft.description} onChange={(event) => setAdminDraft((current) => ({ ...current, description: event.target.value }))} />
                  </label>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={adminSaving} onClick={() => void handleAdminSave()} type="button">
                    {adminSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    保存活动信息
                  </button>
                  <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300" onClick={() => setAdminDraft(eventInfo)} type="button">
                    恢复已保存内容
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-6">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-indigo-500" />
                    <h2 className="text-lg font-semibold">当前汇总</h2>
                  </div>
                  <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                      <div className="text-xs">能来</div>
                      <div className="mt-2 text-2xl font-semibold">{stats.yes.length}</div>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-700">
                      <div className="text-xs">待定</div>
                      <div className="mt-2 text-2xl font-semibold">{stats.maybe.length}</div>
                    </div>
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
                      <div className="text-xs">来不了</div>
                      <div className="mt-2 text-2xl font-semibold">{stats.no.length}</div>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">报名明细</h2>
                      <p className="mt-1 text-sm text-slate-500">这里可以直接改某个人的报名内容，或者在切换到新活动时一键清空旧报名。</p>
                    </div>
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={adminParticipantSaving === "all" || !participants.length}
                      onClick={() => void handleClearAllParticipants()}
                      type="button"
                    >
                      {adminParticipantSaving === "all" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
                      开始新活动：清空全部报名
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {participants.length ? (
                      participants.map((item) => {
                        const meta = statusMeta[item.status];
                        const Icon = meta.icon;
                        const isEditing = editingParticipantId === item.id;
                        const isBusy = adminParticipantSaving === item.id;
                        return (
                          <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4" key={item.id}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-base font-medium text-slate-900">{item.name}</span>
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>
                                    <Icon className="h-3.5 w-3.5" />
                                    {meta.shortLabel}
                                  </span>
                                </div>
                                <div className="mt-2 text-xs text-slate-500">更新于 {formatRelativeTime(item.updatedAt)}</div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isBusy}
                                  onClick={() => handleEditParticipant(item)}
                                  type="button"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  编辑
                                </button>
                                <button
                                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isBusy}
                                  onClick={() => void handleDeleteParticipant(item)}
                                  type="button"
                                >
                                  {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                  删除
                                </button>
                              </div>
                            </div>
                            {isEditing ? (
                              <div className="mt-4 space-y-4 rounded-2xl border border-indigo-100 bg-white p-4">
                                <div className="grid gap-3 sm:grid-cols-3">
                                  {(["yes", "maybe", "no"] as AttendanceStatus[]).map((status) => {
                                    const optionMeta = statusMeta[status];
                                    const OptionIcon = optionMeta.icon;
                                    const active = adminParticipantDraft.status === status;
                                    return (
                                      <button
                                        className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${active ? `${optionMeta.className} shadow-sm` : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
                                        key={status}
                                        onClick={() => setAdminParticipantDraft((current) => ({ ...current, status }))}
                                        type="button"
                                      >
                                        <span className="inline-flex items-center gap-2 font-medium">
                                          <OptionIcon className="h-4 w-4" />
                                          {optionMeta.label}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <label className="block space-y-2 sm:col-span-2">
                                    <span className="text-sm font-medium text-slate-700">名字</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, name: event.target.value }))} value={adminParticipantDraft.name} />
                                  </label>
                                  <label className="block space-y-2">
                                    <span className="text-sm font-medium text-slate-700">预计到达</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, eta: event.target.value }))} value={adminParticipantDraft.eta} />
                                  </label>
                                  <label className="block space-y-2">
                                    <span className="text-sm font-medium text-slate-700">预计离开</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, leaveAt: event.target.value }))} value={adminParticipantDraft.leaveAt} />
                                  </label>
                                  <label className="block space-y-2 sm:col-span-2">
                                    <span className="text-sm font-medium text-slate-700">困难</span>
                                    <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, obstacle: event.target.value }))} value={adminParticipantDraft.obstacle} />
                                  </label>
                                  <label className="block space-y-2 sm:col-span-2">
                                    <span className="text-sm font-medium text-slate-700">备注</span>
                                    <textarea className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" onChange={(event) => setAdminParticipantDraft((current) => ({ ...current, note: event.target.value }))} value={adminParticipantDraft.note} />
                                  </label>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                  <button
                                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={isBusy}
                                    onClick={() => void handleAdminParticipantSave(item.id)}
                                    type="button"
                                  >
                                    {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                    保存这条报名
                                  </button>
                                  <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300" onClick={() => handleCancelParticipantEdit()} type="button">
                                    取消编辑
                                  </button>
                                </div>
                              </div>
                            ) : (item.eta || item.leaveAt || item.obstacle || item.note) ? (
                              <div className="mt-3 space-y-2 text-sm text-slate-600">
                                {item.eta ? <p>预计到达：{item.eta}</p> : null}
                                {item.leaveAt ? <p>预计离开：{item.leaveAt}</p> : null}
                                {item.obstacle ? <p>困难：{item.obstacle}</p> : null}
                                {item.note ? <p>备注：{item.note}</p> : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                        还没有人报名，先从公开页提交第一条吧。
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </section>
          )}

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#050816] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[-8%] h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute right-[-8%] top-[8%] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute bottom-[12%] left-[18%] h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="absolute inset-0">
            <img
              alt="活动氛围背景"
              className="h-full w-full object-cover opacity-30"
              src="https://images.unsplash.com/photo-1505236858219-8359eb29e329?auto=format&fit=crop&w=1800&q=80"
            />
            <div className="absolute inset-0 bg-[linear-gradient(110deg,rgba(5,8,22,0.92)_20%,rgba(5,8,22,0.72)_55%,rgba(5,8,22,0.88)_100%)]" />
          </div>

          <div className="relative grid gap-8 px-5 py-8 md:px-8 md:py-10 xl:grid-cols-[1.1fr_0.9fr] xl:items-end">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-medium tracking-[0.18em] text-cyan-100 uppercase">
                <Sparkles className="h-3.5 w-3.5" />
                Private Gathering Invitation
              </div>

              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-white md:text-6xl xl:text-7xl">
                {eventInfo.title}
              </h1>

              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-200 md:text-base">
                {eventInfo.description || "这次把时间留给见面本身。吃顿饭、聊聊近况、把想见的人重新聚到一张桌上。"}
              </p>

              <div className="mt-6 flex flex-wrap gap-3 text-sm">
                <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-slate-100">
                  活动类型：{eventInfo.category || "节日活动"}
                </span>
                <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-slate-100">
                  {refreshing ? "数据同步中…" : `最近更新 ${formatRelativeTime(eventInfo.updatedAt)}`}
                </span>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-slate-100"
                  href="#signup"
                >
                  立即报名
                  <ArrowRight className="h-4 w-4" />
                </a>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                  onClick={() => void handleCopyShareText()}
                  type="button"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? "已复制群发文案" : "复制群发文案"}
                </button>
                <a
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-6 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
                  href={getAdminUrl()}
                >
                  管理入口
                </a>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {primaryStats.map((item) => (
                  <div
                    className={`rounded-[1.75rem] border border-white/10 bg-gradient-to-br ${item.accent} p-5 backdrop-blur-xl`}
                    key={item.label}
                  >
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-300">{item.label}</div>
                    <div className="mt-3 text-4xl font-semibold text-white">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-5 backdrop-blur-xl">
                <div className="flex items-center gap-2 text-sm font-medium text-cyan-100">
                  <Gem className="h-4 w-4" />
                  今晚安排
                </div>
                <div className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-xs text-slate-400">日期</div>
                    <div className="mt-1">{eventInfo.date || "日期待定"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-xs text-slate-400">时间</div>
                    <div className="mt-1">{formatRange(eventInfo.startTime, eventInfo.endTime)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:col-span-2">
                    <div className="text-xs text-slate-400">地点</div>
                    <div className="mt-1">{eventInfo.location || "地点待定"}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-6">
              <div className="flex items-center gap-2 text-sm font-medium text-cyan-100">
                <Sparkles className="h-4 w-4" />
                这次聚会值得来
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {highlightCards.map((item) => (
                  <article className="rounded-[1.5rem] border border-white/10 bg-slate-950/40 p-5" key={item.title}>
                    <div className="text-lg font-semibold text-white">{item.title}</div>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{item.description}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-6">
              <div className="flex items-center gap-2 text-sm font-medium text-cyan-100">
                <CalendarDays className="h-4 w-4" />
                活动流程卡
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {timelineItems.map((item) => (
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/40 p-5" key={item.label}>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
                    <div className="mt-3 text-lg font-semibold text-white">{item.value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">氛围预览</h2>
                  <p className="mt-2 text-sm text-slate-300">先感受一下这次聚会的节奏：轻松、好看、适合见面，也适合认真聊聊。</p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <article className="group relative overflow-hidden rounded-[1.75rem] border border-white/10">
                  <img alt={galleryImages[0].title} className="h-full min-h-[260px] w-full object-cover transition duration-500 group-hover:scale-105" src={galleryImages[0].image} />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/35 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="text-lg font-semibold text-white">{galleryImages[0].title}</div>
                    <p className="mt-2 text-sm text-slate-200">{galleryImages[0].description}</p>
                  </div>
                </article>
                <div className="grid gap-4">
                  {galleryImages.slice(1).map((item) => (
                    <article className="group relative overflow-hidden rounded-[1.75rem] border border-white/10" key={item.title}>
                      <img alt={item.title} className="h-48 w-full object-cover transition duration-500 group-hover:scale-105" src={item.image} />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-5">
                        <div className="text-base font-semibold text-white">{item.title}</div>
                        <p className="mt-1 text-sm text-slate-200">{item.description}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section id="signup" className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">我的报名</h2>
                  <p className="mt-2 text-sm text-slate-300">同一台设备再次提交，会覆盖之前那条记录。</p>
                </div>
                <button className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200 transition hover:bg-white/10" onClick={() => void refreshActivity(true)} type="button">
                  <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  刷新
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(["yes", "maybe", "no"] as AttendanceStatus[]).map((status) => {
                  const meta = statusMeta[status];
                  const Icon = meta.icon;
                  const active = draft.status === status;
                  return (
                    <button
                      className={`rounded-[1.5rem] border px-4 py-4 text-left transition ${active ? `${meta.className} shadow-lg shadow-black/10` : "border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/20 hover:bg-white/10"}`}
                      key={status}
                      onClick={() => setDraft((current) => ({ ...current, status }))}
                      type="button"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="h-4 w-4" />
                        {meta.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-200">你的名字</span>
                  <input className="w-full rounded-[1.25rem] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="比如：阿哲" value={draft.name} />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">大概几点到</span>
                  <input className="w-full rounded-[1.25rem] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10" onChange={(event) => setDraft((current) => ({ ...current, eta: event.target.value }))} placeholder="比如：19:10" value={draft.eta} />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">大概几点走</span>
                  <input className="w-full rounded-[1.25rem] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10" onChange={(event) => setDraft((current) => ({ ...current, leaveAt: event.target.value }))} placeholder="比如：21:30" value={draft.leaveAt} />
                </label>
                <label className="block space-y-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-200">有什么困难</span>
                  <input className="w-full rounded-[1.25rem] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10" onChange={(event) => setDraft((current) => ({ ...current, obstacle: event.target.value }))} placeholder="比如：下班晚 / 接娃冲突" value={draft.obstacle} />
                </label>
                <label className="block space-y-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-200">备注</span>
                  <textarea className="min-h-28 w-full rounded-[1.25rem] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10" onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="想补充的话写这里" value={draft.note} />
                </label>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto" disabled={submitting} onClick={() => void handleSubmit()} type="button">
                  {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  保存我的情况
                </button>
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10 sm:w-auto" onClick={() => setDraft(mySubmission ? { name: mySubmission.name, status: mySubmission.status, eta: mySubmission.eta, leaveAt: mySubmission.leaveAt, obstacle: mySubmission.obstacle, note: mySubmission.note } : emptyDraft)} type="button">
                  恢复已保存内容
                </button>
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">活动总览</h2>
                  <p className="mt-2 text-sm text-slate-300">发到群里以后，大家一眼就能看懂时间、地点和目前报名情况。</p>
                </div>
                <button className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200 transition hover:bg-white/10" onClick={() => void handleCopyShareText()} type="button">
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? "已复制" : "复制邀请文案"}
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-[1.5rem] border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-100">
                  <div className="text-xs uppercase tracking-[0.2em] text-emerald-200/80">能来</div>
                  <div className="mt-2 text-3xl font-semibold">{stats.yes.length}</div>
                </div>
                <div className="rounded-[1.5rem] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100">
                  <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">待定</div>
                  <div className="mt-2 text-3xl font-semibold">{stats.maybe.length}</div>
                </div>
                <div className="rounded-[1.5rem] border border-rose-400/20 bg-rose-400/10 p-4 text-rose-100">
                  <div className="text-xs uppercase tracking-[0.2em] text-rose-200/80">来不了</div>
                  <div className="mt-2 text-3xl font-semibold">{stats.no.length}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">活动：{eventInfo.category || "待定"}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">总报名：{participants.length}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">待协调：{stats.blockers.length}</span>
                <a className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-cyan-100 transition hover:bg-cyan-400/15" href={getAdminUrl()}>
                  修改活动信息
                </a>
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl md:p-6">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-cyan-200" />
                <h2 className="text-xl font-semibold text-white">报名明细</h2>
              </div>
              <div className="mt-4 space-y-3">
                {participants.length ? (
                  participants.map((item) => {
                    const meta = statusMeta[item.status];
                    const Icon = meta.icon;
                    const isMine = item.viewerToken === viewerToken;
                    return (
                      <article className="rounded-[1.5rem] border border-white/10 bg-slate-950/40 p-4" key={item.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-medium text-white">{item.name}</span>
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>
                                <Icon className="h-3.5 w-3.5" />
                                {meta.shortLabel}
                              </span>
                              {isMine ? <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-100">我提交的</span> : null}
                            </div>
                            <div className="mt-2 text-xs text-slate-400">更新于 {formatRelativeTime(item.updatedAt)}</div>
                          </div>
                          <div className={`h-3 w-3 shrink-0 rounded-full ${meta.softClassName}`} />
                        </div>

                        {(item.eta || item.leaveAt || item.obstacle || item.note) ? (
                          <div className="mt-3 space-y-2 text-sm text-slate-300">
                            {item.eta ? <p>预计到达：{item.eta}</p> : null}
                            {item.leaveAt ? <p>预计离开：{item.leaveAt}</p> : null}
                            {item.obstacle ? <p>困难：{item.obstacle}</p> : null}
                            {item.note ? <p>备注：{item.note}</p> : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-white/15 px-4 py-8 text-center text-sm text-slate-400">
                    还没人填，先提交第一条试试。
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
