import { openWithDialog } from '../../state/actions'
import { fileDragOver } from '../dragState'
import { Icon } from '../Icon'

export function Welcome() {
  return (
    <div class={`welcome ${fileDragOver.value ? 'drag-over' : ''}`}>
      <img src="/icon.svg" alt="" width={96} height={96} />
      <h1>Glance</h1>
      <p>Open a PDF, image, camera RAW or 3D model, or drop files anywhere in this window.</p>
      <button class="btn primary" onClick={() => void openWithDialog()}>
        <Icon name="open" size={16} /> Open…
      </button>
      <p class="hint">Tip: drag pages between documents to merge them, or out of the window to create a new PDF.</p>
    </div>
  )
}
