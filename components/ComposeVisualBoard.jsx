"use client";
// Compose 创作空间内的 V2.3 配图视图（creator-v2.2.html :158 visualBoard +
// creator-v2.3-visual.html :38 inline-slot 的正式实现）。
// 只读：这里展示真实的配图计划（GET /api/illustrations/projects/:id）与
// 每个图位的真实状态（待生成/生成中/待审阅/已选用/生成失败/计划过期），
// 生成、审阅与插入等写操作仍在右侧配图助手（WritingImages，带费用授权）
// 与 /illustrations 视觉工作台完成；本面板不直接调用任何付费接口。
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Tag } from "./creator/primitives";
import { shotTitle, slotView } from "../src/compose-view.mjs";
import { api } from "../lib/creator-client";

export default function ComposeVisualBoard({ projectId, onOpenPlanner }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const serial = useRef(0);
  const root = `/api/illustrations/projects/${projectId}`;

  function load() {
    const token = ++serial.current;
    setError(null);
    api(root)
      .then((data) => {
        if (token === serial.current) setPlan(data);
      })
      .catch((e) => {
        if (token === serial.current) setError(e);
      });
  }
  useEffect(() => {
    load();
    return () => {
      serial.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const shots = plan?.shots || [];
  const stale = !!plan?.stale;

  return (
    <section className="cv2-visual-board" aria-label="配图工作台视图">
      <div className="cv2-visual-head">
        <div>
          <p className="cv2-eyebrow" style={{ margin: 0 }}>
            Visual Studio
          </p>
          <h3>让图片成为内容的一部分</h3>
          <p className="muted">先规划，再生成；每张图独立审阅，不自动覆盖主稿。</p>
        </div>
        <Tag tone="info">AI 配图 · 以真实计划为准</Tag>
      </div>

      {error ? (
        <p className="cv2-status is-error" role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>配图计划读取失败：{error.message}</span>
        </p>
      ) : null}
      {!plan && !error ? (
        <p className="cv2-status" aria-busy="true" role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>正在读取配图计划…</span>
        </p>
      ) : null}

      {stale ? (
        <p className="cv2-source-note" style={{ marginTop: 14 }}>
          主稿已有新版本：这份计划按旧正文生成，需在配图助手中更新计划后才能继续生成；已生成的旧图仍保留。
        </p>
      ) : null}

      {plan && shots.length === 0 ? (
        <div className="cv2-empty" style={{ marginTop: 18 }}>
          <strong>这篇文章还没有配图计划</strong>
          <p>
            先在右侧「配图」助手里依据主稿规划封面和正文插图；规划只确定位置与用途，不会调用图片服务。
          </p>
          <button type="button" className="cv2-btn primary" onClick={onOpenPlanner}>
            去规划全文配图
          </button>
        </div>
      ) : null}

      {shots.length ? (
        <div className="cv2-visual-slots">
          {shots.map((shot) => {
            const view = slotView(shot.status);
            return (
              <button
                key={shot.id}
                type="button"
                className={"cv2-slot" + (shot.status === "planned" ? " is-planned" : "")}
                onClick={onOpenPlanner}
                title="在配图助手中继续这张图"
              >
                <span
                  className={
                    "cv2-slot-art" +
                    (shot.asset?.previewUrl ? "" : " is-empty")
                  }
                >
                  {shot.asset?.previewUrl ? (
                    // 已生成/已选用的真实素材缩略图（本服务素材库 previewUrl）
                    <img src={shot.asset.previewUrl} alt={shot.alt || shotTitle(shot)} />
                  ) : (
                    "＋"
                  )}
                </span>
                <span className="cv2-slot-text">
                  <strong>
                    {shotTitle(shot)} · {view.label}
                  </strong>
                  <small>{shot.alt || shot.scene || "用途待规划"}</small>
                  <em>
                    {shot.status === "planned" ? "去生成" : "去审阅"} →
                  </em>
                </span>
                <span className="cv2-slot-status">
                  <Tag tone={view.tone}>{view.label}</Tag>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {shots.length ? (
        <p style={{ margin: "14px 0 0" }}>
          <Link
            className="cv2-btn tiny"
            href={`/illustrations?project=${encodeURIComponent(projectId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开完整视觉工作台 ↗
          </Link>
        </p>
      ) : null}

      <div className="cv2-visual-note">
        配图验收：视觉与正文是否一致、是否存在虚假界面截图、文字是否可读、平台裁切是否正常。图片不是事实证据；选中候选不会改变文章，明确采用才写入。
      </div>
    </section>
  );
}
