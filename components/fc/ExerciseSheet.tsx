"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from "@/lib/exercise-label";
import { muscleById, type MuscleId } from "@/lib/muscles";
import { sculptureGroup } from "@/lib/sculpture-groups";
import JournalIcon from "@/components/JournalIcon";
import Icon from "@/components/ui/Icon";
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
  label?: string;
  planned: ReadonlySet<string>;
  selected: ReadonlyMap<string, ExerciseChoice>;
  toggle: (exercise: ExerciseChoice) => void;
  saving: boolean;
  error: string;
  complete: () => Promise<number[] | null>;
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

function exerciseIntro(
  pattern: string,
  mechanic: string,
  demand: string,
  fatigue: string,
  reps: string,
) {
  const movement = pattern && pattern !== "other" ? pattern : "全身协同动作";
  const joints =
    mechanic === "compound" || mechanic === "多关节"
      ? "同时带动多个关节"
      : "主要由目标关节完成";
  const effort =
    demand === "高" || demand === "high"
      ? "整体用力需求较高"
      : demand === "低" || demand === "low"
        ? "整体用力需求较低"
        : "整体用力需求适中";
  const rest =
    fatigue === "高" || fatigue === "high"
      ? "建议组间留出充分恢复时间"
      : "按动作质量和个人状态安排休息";
  return `这是一个以${movement}为主的${joints}。${effort}；可先按每组 ${reps} 作为参考，再根据动作标准和训练目标调整。${rest}。`;
}

export default function ExerciseSheet({
  muscle,
  onClose,
  grouped = false,
  onChooseExercise,
  selection,
  preference,
  onSelectionComplete,
}: {
  muscle: MuscleId | null;
  onClose: () => void;
  grouped?: boolean;
  selection?: ExerciseSelection;
  onSelectionComplete?: (addedItemIds: number[]) => void;
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
  const [showSelected, setShowSelected] = useState(false);
  const [state, setState] = useState<Record<string, "busy" | "done" | "err">>(
    {},
  );
  const [toast, setToast] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const selectedList = useRef<HTMLElement>(null);
  const trayToggle = useRef<HTMLButtonElement>(null);
  const listScroll = useRef(0);
  const listRequest = useRef<AbortController | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const query = new URLSearchParams({
    [grouped ? "group" : "muscle"]: muscle ?? "",
    limit: "100",
    steps: "1",
    order: "plan",
  });
  if (preference) query.set("preference", preference);
  for (const equipment of FILTERS.find((item) => item.key === filter)?.equip ??
    []) {
    query.append("equipment", equipment);
  }
  const listUrl = `/api/exercises?${query}`;
  const selectedChoices = selection ? [...selection.selected.values()] : [];
  const reviewing = showSelected && selectedChoices.length > 0;
  const loading = busyList || (!data && !listError);

  function showDetails(item: DictItem) {
    listScroll.current = list.current?.scrollTop ?? 0;
    setActive(item);
  }

  useEffect(() => {
    if (!active && !reviewing && list.current) list.current.scrollTop = listScroll.current;
    if (reviewing) selectedList.current?.focus({ preventScroll: true });
  }, [active, reviewing]);

  useEffect(() => {
    listScroll.current = 0;
    setFilter("all");
    setActive(null);
    setShowSelected(false);
  }, [muscle, grouped]);

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
      if (event.key !== "Escape") return;
      if (active) setActive(null);
      else if (reviewing) {
        setShowSelected(false);
        trayToggle.current?.focus();
      }
      else onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [muscle, active, onClose, reviewing]);

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
        setToast(`已加入${selection?.label ?? "今日训练"}清单`);
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
  const title = preference && base ? `${base} · 我的动作库` : base;

  return (
    <>
      <div className="fc-mask dict" onClick={onClose}>
        <div
          className={`fc-sheet fc-dict-sheet${active ? " fc-dict-detail" : ""}${selection ? " fc-dict-picker" : ""}`}
          role="dialog"
          tabIndex={-1}
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
                <section className="fc-exercise-intro">
                  <h4>动作参考</h4>
                  <p>
                    {exerciseIntro(
                      active.movement_pattern,
                      active.mechanic,
                      active.metabolic_demand,
                      active.fatigue_level,
                      active.recommended_rep_range,
                    )}
                  </p>
                </section>
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

              {selection ? (
                <div className="fc-dict-actions">
                  <button type="button" className="fc-btn primary"
                    disabled={selection.saving || selection.planned.has(active.id)}
                    aria-pressed={selection.selected.has(active.id)}
                    onClick={() => selection.toggle({ id: active.id, name: active.zh_name || active.name })}>
                    {selection.planned.has(active.id) ? `已在${selection?.label ?? "今日训练"}` : selection.selected.has(active.id) ? "取消选择" : "选择这个动作"}
                  </button>
                </div>
              ) : onChooseExercise ? (
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
                  <div className="fc-dict-title">
                    {title ?? "这块肌肉"}
                    <span className="fc-dict-count">
                      {reviewing ? null : loading ? "…" : `${data?.total ?? 0} 个动作`}
                    </span>
                  </div>
                  {!selection && <div className="fc-dict-note">点动作看动图与要点</div>}
                </div>
                <button
                  type="button"
                  className="fc-dict-close"
                  onClick={onClose}
                >
                  关闭
                </button>
              </div>

              {!reviewing && <div className="fc-dict-filters" aria-label="按器械筛选" role="group">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
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
              </div>}

              {reviewing && selection ? (
                <section className="fc-dict-list fc-picker-review" ref={selectedList} tabIndex={-1} aria-label="待添加动作">
                  <h3>待添加</h3>
                  <ul>
                    {selectedChoices.map((exercise) => (
                      <li key={exercise.id}>
                        <span>{exercise.name}</span>
                        <button type="button" aria-label={`取消选择：${exercise.name}`} disabled={selection.saving}
                          onClick={() => {
                            if (selectedChoices.length === 1) setShowSelected(false);
                            selection.toggle(exercise);
                          }}>
                          <Icon name="close" size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : <div className="fc-dict-list" ref={list} aria-busy={loading}>
                {loading && (selection ? (
                  <div role="status">
                    <span className="sr-only">正在加载动作</span>
                    {Array.from({ length: 4 }, (_, index) => (
                      <div className="fc-picker-skeleton" key={index} aria-hidden="true">
                        <i /><span><i /><i /></span><i />
                      </div>
                    ))}
                  </div>
                ) : <p className="fc-note">正在取这一块的动作…</p>)}
                {!loading &&
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

                    return (
                      <div
                        className="fc-dict-select-row"
                        data-selected={selected}
                        key={it.id}
                      >
                        <button
                          type="button"
                          className="fc-dict-item"
                          aria-pressed={selected}
                          disabled={selection.saving || planned}
                          onClick={() => selection.toggle({ id: it.id, name })}
                        >
                          {preview}
                          {planned
                            ? <span className="fc-dict-planned">已安排</span>
                            : <span className="fc-picker-mark" aria-hidden="true">
                                <Icon name="plus" size={16} />
                                <svg className="fc-picker-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                  strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m5 12.5 4.5 4.5L19 7.5" pathLength={1} />
                                </svg>
                              </span>}
                        </button>
                        <button
                          type="button"
                          className="fc-dict-explain"
                          aria-label={`讲解：${name}`}
                          title="动作讲解"
                          onClick={() => showDetails(it)}
                        >
                          <JournalIcon name="book" />
                        </button>
                      </div>
                    );
                  })}
                {!loading && !listError && items.length === 0 && (
                  <p className="fc-note">
                    {preference ? (
                      <>
                        这一块还没有常练动作。可以在
                        <a href="/me/exercises">「我的 · 动作偏好」</a>里标记。
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
                <p className="fc-dict-src">
                  动作数据：hasaneyldrm/exercises-dataset（MIT）· 动图版权 Gym visual
                </p>
              </div>}
              {selection && (
                <div className="fc-dict-actions fc-picker-actions">
                  <span className="sr-only" role="status">{selectedChoices.length} 个动作待添加</span>
                  {selectedChoices.length > 0 ? (
                    <button type="button" className="fc-picker-tray" ref={trayToggle} aria-expanded={reviewing}
                      onClick={() => {
                        if (!reviewing) listScroll.current = list.current?.scrollTop ?? 0;
                        setShowSelected(!reviewing);
                      }}>
                      <span className="fc-picker-count">已选 {selectedChoices.length}</span>
                      {!reviewing && <span className="fc-picker-names">{selectedChoices.map(({ name }) => name).join("、")}</span>}
                      <span className="fc-picker-review-link">
                        {reviewing ? "返回列表" : "查看"}
                        <Icon name={reviewing ? "chevron-left" : "chevron-right"} size={15} />
                      </span>
                    </button>
                  ) : <p className="fc-picker-empty">点 ＋ 选动作，可连续添加</p>}
                  {selection.error && (
                    <p className="fc-note" role="alert">
                      {selection.error}
                    </p>
                  )}
                  <button
                    type="button"
                    className="fc-btn primary"
                    disabled={selection.saving || selection.selected.size === 0}
                    onClick={async () => {
                      const addedItemIds = await selection.complete();
                      if (addedItemIds) (onSelectionComplete ?? onClose)(addedItemIds);
                    }}
                  >
                    {selection.saving ? "加入中…" : `加入${selection?.label ?? "今日训练"}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {toast && <div className="fc-toast">{toast}</div>}
    </>
  );
}
