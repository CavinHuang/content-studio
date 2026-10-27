import room from '../assets/reading-room.svg'
import notebook from '../assets/notebook.svg'
import city from '../assets/city.svg'
import garden from '../assets/garden.svg'
import roomRaw from '../assets/reading-room.svg?raw'
import notebookRaw from '../assets/notebook.svg?raw'
import cityRaw from '../assets/city.svg?raw'
import gardenRaw from '../assets/garden.svg?raw'
export const images: Record<string, string> = { room, notebook, city, garden }

/**
 * 内置插画 → data URL（P5）：导出任务把素材快照冻结进 inputProps，
 * 渲染进程无法在打包后的 file:// 环境里 fetch 相对路径，故以 ?raw 内联后编码。
 */
const svgDataUrl = (raw: string) => `data:image/svg+xml;utf8,${encodeURIComponent(raw.trim())}`
export const imageDataUrls: Record<string, string> = {
  room: svgDataUrl(roomRaw),
  notebook: svgDataUrl(notebookRaw),
  city: svgDataUrl(cityRaw),
  garden: svgDataUrl(gardenRaw),
}
