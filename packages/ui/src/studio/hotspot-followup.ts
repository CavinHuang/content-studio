import { now, uid, type Material, type Project, type SourceArticle, type StudioState, type Topic } from './types'

/**
 * §20.4 显式更新流程：话题对某项目而言的「新文章」＝当前聚合文章 − 创建时快照
 * （project.source.articleIds）− 已补充记录（supplementedArticleIds）。
 * 创建快照永不改写；补充过的文章不再重复罗列为新进展。
 */
export function topicNewArticles(topic: Topic, project: Project): SourceArticle[] {
  const source = project.source
  if (!source || source.topicId !== topic.id) return []
  const seen = new Set([...source.articleIds, ...(source.supplementedArticleIds ?? [])])
  return topic.articles.filter((article) => !seen.has(article.id))
}

/**
 * §20.4 补充动作：把选中的新文章保存为素材并引用到对应项目（沿用既有素材引用模型）。
 * 只动素材与引用；母稿正文、标题与版本一概不碰——改稿仍须经既有建议/候选流。
 * 项目侧在当前会话追加提示：「已补充 N 篇新进展素材，可在 Agent 中生成修改建议」。
 * 无可补充内容时原样返回同一个 state 引用。
 */
export function supplementArticlesToProject(
  state: StudioState,
  topicId: string,
  projectId: string,
  articleIds: string[],
): StudioState {
  const topic = state.topics.find((t) => t.id === topicId)
  const project = state.projects.find((p) => p.id === projectId && !p.trashed)
  const source = project?.source
  if (!topic || !source || source.topicId !== topicId || !articleIds.length) return state
  const supplemented = new Set(source.supplementedArticleIds ?? [])
  const articles = topic.articles.filter(
    (article) =>
      articleIds.includes(article.id) &&
      !source.articleIds.includes(article.id) &&
      !supplemented.has(article.id),
  )
  if (!articles.length) return state
  const materials = [...state.materials]
  const referenced: string[] = []
  for (const article of articles) {
    // 同一链接已有未删除素材时复用（与原文弹窗「保存为素材」同一去重语义）
    const existing = article.url
      ? materials.find((material) => !material.trashed && material.url === article.url)
      : undefined
    if (existing) {
      referenced.push(existing.id)
      continue
    }
    const material: Material = {
      id: uid(),
      title: article.title,
      type: 'link',
      body: article.body,
      url: article.url,
      readState: article.body ? 'ready' : 'link-only',
      tags: [topic.category, '热点后续'],
      at: now(),
    }
    materials.unshift(material)
    referenced.push(material.id)
  }
  const conversation = project!.conversations.find((c) => c.id === project!.activeConversation)
  return {
    ...state,
    materials,
    projects: state.projects.map((p) => {
      if (p.id !== projectId) return p
      const materialIds = [...p.materialIds]
      for (const id of referenced) if (!materialIds.includes(id)) materialIds.push(id)
      return {
        ...p,
        materialIds,
        updated: now(),
        // 创建时快照（articleIds/angle/at）保持原样，补充记录单独落位
        source: {
          ...p.source!,
          supplementedArticleIds: [...(p.source!.supplementedArticleIds ?? []), ...articles.map((a) => a.id)],
        },
        conversations: conversation
          ? p.conversations.map((c) =>
              c.id === conversation.id
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: uid(),
                        role: 'assistant' as const,
                        at: now(),
                        text: `已补充 ${articles.length} 篇新进展素材，可在 Agent 中生成修改建议。本次补充：${articles
                          .map((a) => a.title)
                          .join('、')}。母稿正文不会被改动；修改建议对照采用后才会改稿。`,
                      },
                    ],
                  }
                : c,
            )
          : p.conversations,
      }
    }),
  }
}
