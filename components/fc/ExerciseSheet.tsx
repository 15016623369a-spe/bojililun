"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from "@/lib/exercise-label";
import { muscleById, type MuscleId } from "@/lib/muscles";
import { sculptureGroup } from "@/lib/sculpture-groups";
import JournalIcon from "@/components/JournalIcon";
import type { ExercisePreference } from "@/lib/core/exercise-preferences";

interface DictItem {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  mechanic: string;
  movement_pattern: string;
  metabolic_demand: string;
  met_range: string;
  fatigue_level: string;
  recommended_rep_range: string;
  image: string;
  steps: string[];
  desc: string;
  preference: ExercisePreference | null;
}

interface DictResult {
  label: string | null;
  total: number;
  items: DictItem[];
  nextOffset: number | null;
}

export type ExerciseChoice = { id: string; name: string };
export type ExerciseSelection = {
  planned: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  toggle: (exerciseId: string) => void;
  saving: boolean;
  error: string;
  complete: () => Promise<boolean>;
};

const FILTERS: { key: string; label: string; equip: string[] }[] = [
  { key: "all", label: "全部", equip: [] },
  {
    key: "machine",
    label: "固定器械",
    equip: ["leverage machine", "smith machine", "sled machine"],
  },
  { key: "dumbbell", label: "哑铃", equip: ["dumbbell"] },
  {
    key: "barbell",
    label: "杠铃",
    equip: ["barbell", "olympic barbell", "ez barbell"],
  },
  { key: "body", label: "自重", equip: ["body weight"] },
];

async function fetchExercises(
  url: string,
  signal: AbortSignal,
): Promise<DictResult> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error("动作列表加载失败，请重试");
  return res.json();
}

export default function ExerciseSheet({
  muscle,
  onClose,
  grouped = false,
  onChooseExercise,
  selection,
  preference,
}: {
  muscle: MuscleId | null;
  onClose: () => void;
  grouped?: boolean;
  selection?: ExerciseSelection;
  onChooseExercise?: (exercise: ExerciseChoice) => void;
  /** liked：只看「我的动作库」（在「我的 · 动作偏好」里标为常练的动作） */
  preference?: "liked";
}) {
  const router = useRouter();
  const [data, setData] = useState<DictResult | null>(null);
  const [busyList, setBusyList] = useState(false);
  const [busyMore, setBusyMore] = useState(false);
  const [listError, setListError] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<string>("all");
  const [active, setActive] = useState<DictItem | null>(null);
  const [state, setState] = useState<Record<string, "busy" | "done" | "err">>(
    {},
  );
  const [toast, setToast] = useState("");
  // 「我的动作库」里点「从全部动作添加」后切到这块肌肉的全部动作，点一下就收进我的动作库
  const [browseAll, setBrowseAll] = useState(false);
  const cart = useRef<HTMLButtonElement>(null);
  // 刚选中、正在飞进「完成」的那几行：先留在列表里做收起动画，结束后从列表移走
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const pickedNames = useRef<Record<string, string>>({});
  const list = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const listRequest = useRef<AbortController | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const query = new URLSearchParams({
    [grouped ? "group" : "muscle"]: muscle ?? "",
    limit: "100",
    steps: "1",
    order: "plan",
  });
  const listPreference = preference && !browseAll ? preference : undefined;
  if (listPreference) query.set("preference", listPreference);
  for (const equipment of FILTERS.find((item) => item.key === filter)?.equip ??
    []) {
    query.append("equipment", equipment);
  }
  const listUrl = `/api/exercises?${query}`;

  function showDetails(item: DictItem) {
    listScroll.current = list.current?.scrollTop ?? 0;
    setActive(item);
  }

  useEffect(() => {
    if (!active && list.current) list.current.scrollTop = listScroll.current;
  }, [active]);

  useEffect(() => {
    listScroll.current = 0;
    setFilter("all");
    setActive(null);
    setBrowseAll(false);
  }, [muscle, grouped]);

  /** 选中时整行卡片缩小、沿弧线被丢进底部「完成」按钮，按钮弹一下，像把商品丢进购物车 */
  function flyToCart(row: HTMLElement | null) {
    const to = cart.current;
    if (!row || !to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = row.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.classList.add("cart-ghost-row");
    ghost.removeAttribute("data-leaving");
    Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const flight = ghost.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1, borderRadius: "16px" },
      { transform: "translate(0, -6px) scale(.94)", opacity: 1, borderRadius: "20px", offset: 0.18 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 70}px) scale(.42) rotate(-4deg)`, opacity: 1, borderRadius: "28px", offset: 0.58 },
      { transform: `translate(${dx}px, ${dy}px) scale(.06) rotate(3deg)`, opacity: 0.2, borderRadius: "40px" },
    ], { duration: 680, easing: "cubic-bezier(.45, 0, .3, 1)" });
    flight.onfinish = () => {
      ghost.remove();
      to.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }, { transform: "scale(.98)" }, { transform: "scale(1)" }], { duration: 360, easing: "ease-out" });
    };
  }

  async function setLiked(item: DictItem, liked: boolean) {
    const res = await fetch("/api/exercise-preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exerciseId: item.id, preference: liked ? "liked" : null }),
    });
    if (!res.ok) throw new Error();
    setData((current) => current && {
      ...current,
      total: liked || browseAll ? current.total : Math.max(0, current.total - 1),
      items: liked || browseAll
        ? current.items.map((x) => (x.id === item.id ? { ...x, preference: liked ? "liked" : null } : x))
        : current.items.filter((x) => x.id !== item.id),
    });
  }

  function pick(item: DictItem, row: HTMLElement | null) {
    if (!selection || selection.saving || selection.planned.has(item.id)) return;
    const adding = !selection.selected.has(item.id);
    selection.toggle(item.id);
    pickedNames.current[item.id] = item.zh_name || item.name;
    if (adding) {
      flyToCart(row?.closest<HTMLElement>(".swipe-row") ?? row);
      setLeaving((current) => new Set(current).add(item.id));
      window.setTimeout(() => setLeaving((current) => { const next = new Set(current); next.delete(item.id); return next; }), 460);
    }
    if (adding && browseAll && item.preference !== "liked") {
      setLiked(item, true).then(() => setToast(`已收进我的动作库：${item.zh_name || item.name}`)).catch(() => setToast("收藏失败，动作仍已选中"));
    }
  }

  async function removeLiked(item: DictItem) {
    try {
      await setLiked(item, false);
      if (selection?.selected.has(item.id)) selection.toggle(item.id);
      setToast(`已移出我的动作库：${item.zh_name || item.name}`);
    } catch {
      setToast("移出失败，请重试");
    }
  }

  useEffect(() => {
    if (!muscle) return;
    const request = new AbortController();
    listRequest.current = request;
    setBusyList(true);
    setBusyMore(false);
    setListError("");
    setData(null);
    fetchExercises(listUrl, request.signal)
      .then((json) => {
        if (!request.signal.aborted) setData(json);
      })
      .catch(() => {
        if (!request.signal.aborted) setListError("动作列表加载失败，请重试");
      })
      .finally(() => {
        if (!request.signal.aborted) setBusyList(false);
      });
    return () => {
      request.abort();
    };
  }, [muscle, listUrl, reload]);

  async function loadMore() {
    const request = listRequest.current;
    if (
      !request ||
      request.signal.aborted ||
      moreRequest.current === request ||
      data?.nextOffset == null
    )
      return;
    moreRequest.current = request;
    setBusyMore(true);
    setListError("");
    try {
      const page = await fetchExercises(
        `${listUrl}&offset=${data.nextOffset}`,
        request.signal,
      );
      if (!request.signal.aborted)
        setData({ ...page, items: [...data.items, ...page.items] });
    } catch {
      if (!request.signal.aborted) setListError("加载更多动作失败，请重试");
    } finally {
      if (moreRequest.current === request) moreRequest.current = null;
      if (!request.signal.aborted) setBusyMore(false);
    }
  }

  useEffect(() => {
    if (!muscle) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [muscle, onClose]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const items = data?.items ?? [];

  const markDone = useCallback(
    async (it: DictItem) => {
      setState((prev) => ({ ...prev, [it.id]: "busy" }));
      try {
        const res = await fetch("/api/log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: `练了${it.zh_name || it.name}` }),
        });
        if (!res.ok) throw new Error("记录失败");
        setState((prev) => ({ ...prev, [it.id]: "done" }));
        setToast("已记入今天的训练记录");
        router.refresh();
      } catch {
        setState((prev) => ({ ...prev, [it.id]: "err" }));
        setToast("没记上，再试一次");
      }
    },
    [router],
  );

  const addToPlan = useCallback(
    async (it: DictItem) => {
      setState((prev) => ({ ...prev, [`plan-${it.id}`]: "busy" }));
      try {
        const res = await fetch("/api/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ exerciseId: it.id }),
        });
        if (!res.ok) throw new Error("加入失败");
        setState((prev) => ({ ...prev, [`plan-${it.id}`]: "done" }));
        setToast("已加入今日训练清单");
        router.refresh();
      } catch {
        setState((prev) => ({ ...prev, [`plan-${it.id}`]: "err" }));
        setToast("加入失败");
      }
    },
    [router],
  );

  if (!muscle) return null;
  const def = muscleById(muscle);
  const base = grouped
    ? sculptureGroup(muscle)?.label
    : def
      ? `${def.region}·${def.label}`
      : undefined;
  const title = preference && base ? `${base} · ${browseAll ? "全部动作" : "我的动作库"}` : base;

  return (
    <>
      <div className="fc-mask dict" onClick={onClose}>
        <div
          className={`fc-sheet fc-dict-sheet${active ? " fc-dict-detail" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={`${title ?? "肌群"}动作列表`}
          onClick={(e) => e.stopPropagation()}
        >
          {active ? (
            <>
              <div className="fc-dict-detail-top">
                <button
                  type="button"
                  className="fc-dict-back"
                  onClick={() => setActive(null)}
                >
                  ‹ 动作列表
                </button>
                <button
                  type="button"
                  className="fc-dict-close"
                  onClick={onClose}
                >
                  关闭
                </button>
              </div>

              <div className="fc-dict-detail-body">
                <div className="fc-dict-hero">
                  <span className="fc-dict-gif big">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(active.image)}
                      alt={active.zh_name || active.name}
                    />
                  </span>
                  <div>
                    <div className="fc-dict-name">
                      {active.zh_name || active.name}
                    </div>
                    <div className="fc-dict-en">{active.name}</div>
                    <div className="fc-dict-chips">
                      <span>
                        {EQUIPMENT_LABEL[active.equipment] ?? active.equipment}
                      </span>
                      <span>
                        {TARGET_LABEL[active.target] ?? active.target}
                      </span>
                    </div>
                  </div>
                </div>

                <h4 className="fc-dict-sub">要点</h4>
                <div className="fc-exercise-metrics">
                  <span>
                    {active.mechanic === "compound" ||
                    active.mechanic === "多关节"
                      ? "多关节动作"
                      : "单关节动作"}
                  </span>
                  <span>{active.movement_pattern}</span>
                  <span>消耗参考：MET {active.met_range}</span>
                  <span>疲劳程度：{active.fatigue_level}</span>
                  <span>建议范围：{active.recommended_rep_range}</span>
                </div>
                <p className="fc-exercise-note">
                  MET
                  是动作类型的参考强度，不代表单组卡路里；实际消耗会随体重、负荷和组间休息变化。
                </p>
                {active.steps.length > 0 ? (
                  <ol className="fc-dict-steps">
                    {active.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="fc-note">这个动作暂时没有分步说明。</p>
                )}
              </div>

              {selection ? null : onChooseExercise ? (
                <div className="fc-dict-actions">
                  <button
                    type="button"
                    className="fc-btn primary"
                    onClick={() => {
                      onChooseExercise({
                        id: active.id,
                        name: active.zh_name || active.name,
                      });
                      setActive(null);
                      onClose();
                    }}
                  >
                    选择此动作
                  </button>
                </div>
              ) : (
                <>
                  <div className="fc-dict-actions">
                    <button
                      type="button"
                      className="fc-btn primary"
                      onClick={() => void markDone(active)}
                      disabled={state[active.id] === "busy"}
                    >
                      {state[active.id] === "done"
                        ? "✓ 已记入今天"
                        : state[active.id] === "busy"
                          ? "记录中…"
                          : "✓ 记入今天"}
                    </button>
                    <button
                      type="button"
                      className="fc-btn ghost"
                      onClick={() => void addToPlan(active)}
                      disabled={state[`plan-${active.id}`] === "busy"}
                    >
                      {state[`plan-${active.id}`] === "done"
                        ? "✓ 已在清单"
                        : "+ 加入训练"}
                    </button>
                  </div>
                  <p className="fc-dict-src">
                    <a href={`/exercises/${active.id}`}>看完整详情与步骤 →</a>
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <div className="fc-dict-head">
                <div>
                  {browseAll && <button type="button" className="fc-dict-back mine-back" onClick={() => setBrowseAll(false)}>‹ 我的动作库</button>}
                  <div className="fc-dict-title">
                    {title ?? "当前部位"}
                    <span className="fc-dict-count">
                      {busyList ? "…" : `${data?.total ?? 0} 个动作`}
                    </span>
                  </div>
                  <div className="fc-dict-note">
                    {!selection ? "点动作看动图与要点"
                      : browseAll ? "点按选中并加入我的动作库，左滑看详情"
                        : preference ? "点动作选中，左滑看详情或移出" : "点动作选中，左滑看详情"}
                  </div>
                </div>
                <button
                  type="button"
                  className="fc-dict-close"
                  onClick={onClose}
                >
                  关闭
                </button>
              </div>

              <div className="fc-dict-filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={filter === f.key ? "on" : ""}
                    onClick={() => {
                      listScroll.current = 0;
                      if (list.current) list.current.scrollTop = 0;
                      setFilter(f.key);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="fc-dict-list" ref={list}>
                {busyList && <p className="fc-note">正在加载动作…</p>}
                {!busyList &&
                  items.map((it) => {
                    const name = it.zh_name || it.name;
                    const planned = selection?.planned.has(it.id);
                    const selected = planned || selection?.selected.has(it.id);
                    const preview = (
                      <>
                        <span className="fc-dict-gif">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageUrl(it.image)} alt="" loading="lazy" />
                        </span>
                        <span className="fc-dict-item-body">
                          <b>{name}</b>
                          <em>
                            {EQUIPMENT_LABEL[it.equipment] ?? it.equipment} ·{" "}
                            {TARGET_LABEL[it.target] ?? it.target}
                            {it.preference === "liked"
                              ? " · 常练"
                              : it.preference === "disliked"
                                ? " · 不喜欢"
                                : ""}
                          </em>
                        </span>
                      </>
                    );

                    if (!selection)
                      return (
                        <button
                          type="button"
                          key={it.id}
                          className="fc-dict-item"
                          onClick={() => showDetails(it)}
                        >
                          {preview}
                          <span className="fc-dict-arrow" aria-hidden="true">
                            ›
                          </span>
                        </button>
                      );

                    const mine = Boolean(preference) && !browseAll;
                    // 选中的动作已经「丢进」完成按钮，列表里不再显示；已在计划的照常显示为不可选
                    if (!planned && selection.selected.has(it.id) && !leaving.has(it.id)) return null;
                    return (
                      <SwipeRow
                        key={it.id}
                        leaving={leaving.has(it.id)}
                        selected={Boolean(selected)}
                        actions={<>
                          <button type="button" className="swipe-act info" onClick={() => showDetails(it)}>
                            <JournalIcon name="book" /><span>详情</span>
                          </button>
                          {mine && <button type="button" className="swipe-act remove" onClick={() => void removeLiked(it)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M5 7h14M10 11v6m4-6v6M8 7l1-3h6l1 3m-9 0 1 13h8l1-13" /></svg>
                            <span>移出</span>
                          </button>}
                        </>}
                        width={mine ? 148 : 78}
                      >
                        <button
                          type="button"
                          className="fc-dict-item"
                          aria-pressed={selected}
                          disabled={selection.saving || planned}
                          onClick={(event) => pick(it, event.currentTarget)}
                        >
                          {preview}
                          {planned && (
                            <span className="fc-dict-planned">已在计划</span>
                          )}
                        </button>
                      </SwipeRow>
                    );
                  })}
                {!busyList && preference && !browseAll && selection && (
                  <button type="button" className="dict-add-all" onClick={() => { listScroll.current = 0; setBrowseAll(true); }}>
                    <span aria-hidden="true">+</span>从全部动作添加<small>点一下就收进我的动作库</small>
                  </button>
                )}
                {!busyList && !listError && items.length === 0 && (
                  <p className="fc-note">
                    {preference && !browseAll ? (
                      selection ? "这个部位还没有常练动作，从下面的全部动作里挑几个吧。" : <>
                        这个部位还没有常练动作，可以在
                        <a href="/me/exercises">「我的 · 动作偏好」</a>里添加。
                      </>
                    ) : (
                      "这个筛选下没有动作，换个器械试试。"
                    )}
                  </p>
                )}
                {listError && (
                  <p className="fc-note" role="alert">
                    {listError}
                  </p>
                )}
                {listError && !data && (
                  <button
                    type="button"
                    className="fc-btn ghost"
                    onClick={() => setReload((value) => value + 1)}
                  >
                    重新加载
                  </button>
                )}
                {data?.nextOffset != null && (
                  <button
                    type="button"
                    className="fc-btn ghost"
                    disabled={busyMore}
                    onClick={() => void loadMore()}
                  >
                    {busyMore ? "正在加载…" : "加载更多动作"}
                  </button>
                )}
              </div>
              {selection && (
                <div className="fc-dict-actions">
                  {selection.selected.size > 0 && (
                    <div className="cart-tray" aria-label="已选动作">
                      {[...selection.selected].map((id) => {
                        const name = pickedNames.current[id] ?? items.find((x) => x.id === id)?.zh_name ?? "已选动作";
                        return <button key={id} type="button" className="cart-chip" onClick={() => selection.toggle(id)} aria-label={`取消选择${name}`}>
                          {name}<span aria-hidden="true">×</span>
                        </button>;
                      })}
                    </div>
                  )}
                  {selection.error && (
                    <p className="fc-note" role="alert">
                      {selection.error}
                    </p>
                  )}
                  <button
                    ref={cart}
                    type="button"
                    className="fc-btn primary cart-btn"
                    disabled={selection.saving || selection.selected.size === 0}
                    onClick={async () => {
                      if (await selection.complete()) onClose();
                    }}
                  >
                    {selection.saving ? "保存中…" : "完成"}
                    {!selection.saving && selection.selected.size > 0 && (
                      <span className="cart-count" key={selection.selected.size}>{selection.selected.size}</span>
                    )}
                  </button>
                </div>
              )}
              <p className="fc-dict-src">
                动作数据：hasaneyldrm/exercises-dataset（MIT）· 动图版权 Gym
                visual
              </p>
            </>
          )}
        </div>
      </div>

      {toast && <div className="fc-toast">{toast}</div>}
    </>
  );
}

/** 左滑露出操作：横向拖动超过一半就停在打开位置；打开时点前景先收回，不触发选中 */
function SwipeRow({ children, actions, width, selected, leaving = false }: {
  leaving?: boolean;
  children: React.ReactNode;
  actions: React.ReactNode;
  width: number;
  selected: boolean;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; id: number; axis?: "x" | "y" } | null>(null);
  const swallow = useRef(false);

  function down(event: React.PointerEvent<HTMLDivElement>) {
    start.current = { x: event.clientX, y: event.clientY, base: x, id: event.pointerId };
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s || s.id !== event.pointerId) return;
    const dx = event.clientX - s.x, dy = event.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { s.axis = "x"; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }
      else if (Math.abs(dy) > 8) s.axis = "y";
    }
    if (s.axis === "x") setX(Math.max(-width - 28, Math.min(0, s.base + dx)));
  }
  function up(event: React.PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s || s.id !== event.pointerId) return;
    start.current = null;
    if (s.axis === "x") {
      swallow.current = true;
      setDragging(false);
      setX((value) => (value < -width / 2 ? -width : 0));
    }
  }
  function clickCapture(event: React.MouseEvent) {
    if (swallow.current || x !== 0) {
      event.preventDefault();
      event.stopPropagation();
      if (!swallow.current) setX(0);
    }
    swallow.current = false;
  }

  return <div className="fc-dict-select-row swipe-row" data-selected={selected} data-open={x !== 0 || undefined} data-leaving={leaving || undefined}>
    <div className="swipe-actions" style={{ width }} onClick={() => setX(0)}>{actions}</div>
    <div className="swipe-front" data-dragging={dragging || undefined} style={{ transform: `translateX(${x}px)` }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={clickCapture}>
      {children}
    </div>
  </div>;
}
