import type { NoticeDoc } from '../../state/documents'

export function NoticeView({ doc }: { doc: NoticeDoc }) {
  return (
    <div class="notice">
      <h2>{doc.title}</h2>
      {doc.message.split('\n\n').map((para, i) => (
        <p key={i} class={/^winget /.test(para) ? 'code' : ''}>
          {para}
        </p>
      ))}
      {doc.actions.length > 0 && (
        <div class="notice-actions">
          {doc.actions.map((a, i) => (
            <button key={a.label} class={i === 0 ? 'btn primary' : 'btn'} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
