import { ICONS, type IconName } from './icons'

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <span
      class="icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}
