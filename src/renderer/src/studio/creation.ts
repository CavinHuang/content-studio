import {
  makeDraft,
  now,
  uid,
  versioned,
  type CreationSnapshot,
  type CreationFlow,
  type Project,
  type StudioState,
} from './types'

export function recoverCreation(flow?: CreationFlow): CreationFlow | undefined {
  return flow?.status === 'running'
    ? {
        ...flow,
        status: 'stopped',
        runId: undefined,
        message: '上次整理被中断。输入与素材已保留，可继续整理。',
      }
    : flow
}

// Deliberately extractive local prototype: no invented interpretation, web fetch or model call.
export function creationSnapshot(state: StudioState, project: Project): CreationSnapshot {
  const input = project.creation?.input ?? ''
  const first =
    input
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? ''
  return {
    input,
    title:
      first && !/^https?:\/\//i.test(first)
        ? first
        : project.brief.topic.trim() || project.drafts.master?.title.trim() || project.title.trim(),
    point: project.brief.point,
    tone: project.brief.tone || state.preferences.tone,
    language: state.preferences.language,
    materials: project.materialIds.flatMap((id) => {
      const material = state.materials.find((m) => m.id === id && !m.trashed)
      return material
        ? [
            {
              id: material.id,
              title: material.title,
              body: material.body,
              url: material.url,
              type: material.type,
            },
          ]
        : []
    }),
  }
}

export function creationProblem(snapshot: CreationSnapshot): string | undefined {
  if (!snapshot.title) return '这次想写什么？请在第一行补一个主题或问题；原始记录会保留。'
  if (snapshot.input.length > 30_000 || snapshot.materials.reduce((n, m) => n + m.body.length, 0) > 100_000)
    return '这批文字超过本地演示的整理容量。请拆成较小的一批，原文和母稿会保留。'
}

const quote = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
export function composeCreation(snapshot: CreationSnapshot): { title: string; body: string } {
  const firstLineIndex = snapshot.input.split(/\r?\n/).findIndex((line) => line.trim())
  const lines = snapshot.input.split(/\r?\n/)
  const first = lines[firstLineIndex]?.trim() ?? ''
  // A URL cannot act as an inferred topic; retain it as source material.
  const notes = /^https?:\/\//i.test(first) ? snapshot.input : lines.slice(firstLineIndex + 1).join('\n')
  const sections = [
    '材料整理底稿\n\n以下仅将你的方向和原始材料编排为可编辑底稿；尚未生成论证或核实事实。',
    `## 这次想说清楚的事\n\n${quote(snapshot.title)}`,
  ]
  if (snapshot.point.trim()) sections.push(`### 已有核心观点（作者填写）\n\n${quote(snapshot.point)}`)
  if (notes.trim()) sections.push(`## 我的原始记录\n\n${quote(notes)}`)
  for (const material of snapshot.materials) {
    sections.push(
      `### 素材：${material.title}\n\n${material.body.trim() ? quote(material.body) : '待补充原文；未读取图片、文件或链接内容。'}${material.url ? `\n\n来源链接（未抓取、未核验）：${material.url}` : ''}`,
    )
  }
  sections.push(
    `## 继续写成自己的表达\n\n【待作者补充】这些记录支持什么判断？哪些只是个别经历，尚不能推广？\n\n【待作者补充】用一个具体例子说明，再给出结论；材料不足的地方保留问题。`,
  )
  return { title: snapshot.title, body: sections.join('\n\n') }
}

// A run is tied to one immutable snapshot and one project's master. Late callbacks are harmless.
export function finishCreation(
  state: StudioState,
  projectId: string,
  runId: string,
  compose = composeCreation,
): StudioState {
  const project = state.projects.find((p) => p.id === projectId)
  const flow = project?.creation
  if (
    !project ||
    project.trashed ||
    !flow ||
    flow.runId !== runId ||
    flow.status !== 'running' ||
    !flow.snapshot ||
    !flow.candidate
  )
    return state
  let nextProject: Project
  try {
    const result = compose(flow.snapshot)
    const master = project.drafts.master ?? makeDraft(project.title)
    const changed = master.title !== flow.candidate.baseTitle || master.body !== flow.candidate.baseBody
    if (master.body.trim() || changed) {
      nextProject = {
        ...project,
        creation: {
          ...flow,
          status: 'candidate',
          candidate: { ...flow.candidate, ...result },
          message: changed
            ? '生成期间母稿有修改，已保留。候选可查看；重新整理后才能替换。'
            : '新方向已整理成候选，现有母稿保持原样。',
        },
      }
    } else {
      nextProject = applyCreation(project, result.title, result.body)
    }
  } catch {
    nextProject = {
      ...project,
      creation: { ...flow, status: 'failed', message: '整理失败。输入、素材和母稿已保留，可在这里重试。' },
    }
  }
  return { ...state, projects: state.projects.map((p) => (p.id === projectId ? nextProject : p)) }
}

export function applyCreation(project: Project, title: string, body: string): Project {
  const master = project.drafts.master ?? makeDraft(project.title)
  return {
    ...project,
    title,
    updated: now(),
    drafts: { ...project.drafts, master: versioned(master, { title, body }, '整理原始材料') },
    creation: {
      ...project.creation!,
      status: 'ready',
      candidate: undefined,
      message: '原始材料已整理到母稿。可直接编辑；未补写事实或替你确定观点。',
      applied: { title, body, previousTitle: master.title, previousBody: master.body },
    },
  }
}

export function beginCreation(state: StudioState, projectId: string): { state: StudioState; runId?: string } {
  const project = state.projects.find((p) => p.id === projectId && !p.trashed)
  if (!project?.creation || project.creation.status === 'running') return { state }
  const snapshot = creationSnapshot(state, project)
  const problem = creationProblem(snapshot)
  const runId = uid()
  const master = project.drafts.master ?? makeDraft(project.title)
  return {
    runId: problem ? undefined : runId,
    state: {
      ...state,
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              creation: {
                ...project.creation!,
                snapshot,
                status: problem ? 'blocked' : 'running',
                message: problem,
                runId,
                candidate: { title: '', body: '', baseTitle: master.title, baseBody: master.body },
              },
            }
          : p,
      ),
    },
  }
}
