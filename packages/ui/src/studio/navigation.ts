import { Clapperboard, FileText, Paperclip, SquarePen } from 'lucide-react'

export const artifactTabs = [
  { id: 'plan', label: '创作方案', icon: SquarePen },
  { id: 'article', label: '文稿', icon: FileText },
  { id: 'video', label: '视频', icon: Clapperboard },
  { id: 'materials', label: '素材', icon: Paperclip },
] as const
